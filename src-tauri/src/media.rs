use std::io::Cursor;
use std::time::Duration;

use base64::Engine;
use fast_image_resize::{FilterType, Resizer, ResizeAlg, ResizeOptions};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageFormat, RgbImage, RgbaImage};
use moka::sync::Cache;
use rig::message::ImageMediaType;

use crate::error::{AppError, AppResult};

pub const RASTER_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

pub fn is_raster_extension(ext: &str) -> bool {
    RASTER_EXTENSIONS.contains(&ext)
}

fn flatten_to_rgb(image: &DynamicImage) -> DynamicImage {
    if !image.color().has_alpha() {
        return DynamicImage::ImageRgb8(image.to_rgb8());
    }
    let (width, height) = image.dimensions();
    let mut rgba = RgbaImage::from_pixel(width, height, image::Rgba([255, 255, 255, 255]));
    image::imageops::overlay(&mut rgba, &image.to_rgba8(), 0, 0);
    DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(rgba).to_rgb8())
}

fn resize_image(image: &DynamicImage, width: u32, height: u32) -> AppResult<DynamicImage> {
    let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3));
    let mut resizer = Resizer::new();
    if image.color().has_alpha() {
        let source = image.to_rgba8();
        let mut destination = RgbaImage::new(width, height);
        resizer
            .resize(&source, &mut destination, Some(&options))
            .map_err(|error| AppError::other(format!("image resize failed: {error}")))?;
        Ok(DynamicImage::ImageRgba8(destination))
    } else {
        let source = image.to_rgb8();
        let mut destination = RgbImage::new(width, height);
        resizer
            .resize(&source, &mut destination, Some(&options))
            .map_err(|error| AppError::other(format!("image resize failed: {error}")))?;
        Ok(DynamicImage::ImageRgb8(destination))
    }
}

fn fit_dimensions(width: u32, height: u32, max_dimension: u32) -> (u32, u32) {
    let scale = (max_dimension as f64 / width as f64)
        .min(max_dimension as f64 / height as f64)
        .min(1.0);
    (
        ((width as f64 * scale).floor() as u32).max(1),
        ((height as f64 * scale).floor() as u32).max(1),
    )
}

fn encode_jpeg(image: &DynamicImage, quality: u8) -> AppResult<Vec<u8>> {
    let rgb = flatten_to_rgb(image);
    let mut cursor = Cursor::new(Vec::new());
    rgb.write_with_encoder(JpegEncoder::new_with_quality(&mut cursor, quality))
        .map_err(|e| AppError::other(format!("image encode failed: {e}")))?;
    Ok(cursor.into_inner())
}

fn encode_png(image: &DynamicImage) -> AppResult<Vec<u8>> {
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| AppError::other(format!("image encode failed: {e}")))?;
    Ok(cursor.into_inner())
}

fn media_for_extension(ext: &str) -> Option<ImageMediaType> {
    match ext {
        "png" => Some(ImageMediaType::PNG),
        "jpg" | "jpeg" => Some(ImageMediaType::JPEG),
        "webp" => Some(ImageMediaType::WEBP),
        "gif" => Some(ImageMediaType::GIF),
        _ => None,
    }
}

pub fn encode_for_model(bytes: &[u8], ext: &str, max_dimension: u32, max_bytes: usize) -> AppResult<(String, ImageMediaType)> {
    if let Some(media) = media_for_extension(ext) {
        if bytes.len() <= max_bytes {
            // Only skip resizing if dimensions are also within limits.
            let dims_ok = image_dimensions(bytes)
                .map(|(w, h)| w <= max_dimension && h <= max_dimension)
                .unwrap_or(false);
            if dims_ok {
                return Ok((base64::engine::general_purpose::STANDARD.encode(bytes), media));
            }
        }
    }
    let image = image::load_from_memory(bytes)
        .map_err(|e| AppError::other(format!("cannot decode image: {e}")))?;
    let (width, height) = image.dimensions();
    let resized = if width > max_dimension || height > max_dimension {
        let (width, height) = fit_dimensions(width, height, max_dimension);
        resize_image(&image, width, height)?
    } else {
        image
    };
    // Prefer JPEG for opaque images (smaller output); PNG only when alpha is needed.
    if resized.color().has_alpha() {
        let encoded = encode_png(&resized)?;
        Ok((base64::engine::general_purpose::STANDARD.encode(encoded), ImageMediaType::PNG))
    } else {
        let encoded = encode_jpeg(&resized, 85)?;
        Ok((base64::engine::general_purpose::STANDARD.encode(encoded), ImageMediaType::JPEG))
    }
}

pub fn preview_data_url(bytes: &[u8], mime: &str, max_dimension: u32) -> AppResult<String> {
    // Fast header-only dimension check — avoid full pixel decode when not needed.
    if let Some((width, height)) = image_dimensions(bytes) {
        if width <= max_dimension && height <= max_dimension {
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            return Ok(format!("data:{mime};base64,{b64}"));
        }
    }
    let image = image::load_from_memory(bytes)
        .map_err(|e| AppError::other(format!("cannot decode image: {e}")))?;
    let (width, height) = image.dimensions();
    if width <= max_dimension && height <= max_dimension {
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        return Ok(format!("data:{mime};base64,{b64}"));
    }
    let (resize_width, resize_height) = fit_dimensions(width, height, max_dimension);
    let resized = resize_image(&image, resize_width, resize_height)?;
    let (encoded, out_mime) = if resized.color().has_alpha() {
        (encode_png(&resized)?, "image/png")
    } else {
        (encode_jpeg(&resized, 88)?, "image/jpeg")
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(encoded);
    Ok(format!("data:{out_mime};base64,{b64}"))
}

fn thumbnail_cache() -> &'static Cache<String, String> {
    static CACHE: std::sync::OnceLock<Cache<String, String>> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| {
        Cache::builder()
            .max_capacity(256)
            .time_to_idle(Duration::from_secs(300))
            .build()
    })
}

pub fn thumbnail_data_url_from_base64(b64: &str, mime: &str, max_dimension: u32) -> Option<String> {
    let key = crate::util::fast_hash_hex(b64);
    if let Some(cached) = thumbnail_cache().get(&key) {
        return Some(cached);
    }

    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.as_bytes()).ok()?;
    if let Some((width, height)) = image_dimensions(&bytes) {
        if width <= max_dimension && height <= max_dimension && b64.len() <= 200_000 {
            let res = format!("data:{mime};base64,{b64}");
            thumbnail_cache().insert(key, res.clone());
            return Some(res);
        }
    }
    let image = image::load_from_memory(&bytes).ok()?;
    let (width, height) = image.dimensions();
    if width <= max_dimension && height <= max_dimension && b64.len() <= 200_000 {
        let res = format!("data:{mime};base64,{b64}");
        thumbnail_cache().insert(key, res.clone());
        return Some(res);
    }
    let (thumb_width, thumb_height) = fit_dimensions(width, height, max_dimension);
    let thumb = resize_image(&image, thumb_width, thumb_height).ok()?;
    let encoded = encode_jpeg(&thumb, 75).ok()?;
    let res = format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(encoded)
    );
    thumbnail_cache().insert(key, res.clone());
    Some(res)
}

pub fn image_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()
        .and_then(|r| r.into_dimensions().ok())
}
