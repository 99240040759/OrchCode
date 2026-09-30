use std::io::Cursor;

use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageFormat};
use rig::message::ImageMediaType;

use crate::error::{AppError, AppResult};

pub const RASTER_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

pub fn is_raster_extension(ext: &str) -> bool {
    RASTER_EXTENSIONS.contains(&ext)
}

fn encode_jpeg(image: &DynamicImage, quality: u8) -> AppResult<Vec<u8>> {
    let rgb = DynamicImage::ImageRgb8(image.to_rgb8());
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
    let image = image::load_from_memory(bytes)
        .map_err(|e| AppError::other(format!("cannot decode image: {e}")))?;
    let (width, height) = image.dimensions();
    let within_bounds = width <= max_dimension && height <= max_dimension && bytes.len() <= max_bytes;
    if within_bounds {
        if let Some(media) = media_for_extension(ext) {
            return Ok((base64::engine::general_purpose::STANDARD.encode(bytes), media));
        }
    }
    let resized = if width > max_dimension || height > max_dimension {
        image.thumbnail(max_dimension, max_dimension)
    } else {
        image
    };
    let (encoded, media) = if resized.color().has_alpha() {
        let png = encode_png(&resized)?;
        if png.len() <= max_bytes {
            (png, ImageMediaType::PNG)
        } else {
            (encode_jpeg(&resized, 85)?, ImageMediaType::JPEG)
        }
    } else {
        (encode_jpeg(&resized, 85)?, ImageMediaType::JPEG)
    };
    Ok((base64::engine::general_purpose::STANDARD.encode(encoded), media))
}

pub fn preview_data_url(bytes: &[u8], mime: &str, max_dimension: u32) -> AppResult<String> {
    let image = image::load_from_memory(bytes)
        .map_err(|e| AppError::other(format!("cannot decode image: {e}")))?;
    let (width, height) = image.dimensions();
    if width <= max_dimension && height <= max_dimension {
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        return Ok(format!("data:{mime};base64,{b64}"));
    }
    let resized = image.thumbnail(max_dimension, max_dimension);
    let (encoded, out_mime) = if resized.color().has_alpha() {
        (encode_png(&resized)?, "image/png")
    } else {
        (encode_jpeg(&resized, 88)?, "image/jpeg")
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(encoded);
    Ok(format!("data:{out_mime};base64,{b64}"))
}

pub fn thumbnail_data_url_from_base64(b64: &str, mime: &str, max_dimension: u32) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.as_bytes()).ok()?;
    let image = image::load_from_memory(&bytes).ok()?;
    let (width, height) = image.dimensions();
    if width <= max_dimension && height <= max_dimension && b64.len() <= 200_000 {
        return Some(format!("data:{mime};base64,{b64}"));
    }
    let thumb = image.thumbnail(max_dimension, max_dimension);
    let encoded = encode_jpeg(&thumb, 75).ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(encoded)
    ))
}

pub fn image_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    image::load_from_memory(bytes).ok().map(|img| img.dimensions())
}
