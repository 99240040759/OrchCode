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

fn flatten_to_rgb(image: &DynamicImage) -> DynamicImage {
    if !image.color().has_alpha() {
        return DynamicImage::ImageRgb8(image.to_rgb8());
    }
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut rgb = image::RgbImage::new(width, height);
    for (x, y, pixel) in rgba.enumerate_pixels() {
        let alpha = pixel[3] as f32 / 255.0;
        let r = ((1.0 - alpha) * 255.0 + alpha * (pixel[0] as f32)).round() as u8;
        let g = ((1.0 - alpha) * 255.0 + alpha * (pixel[1] as f32)).round() as u8;
        let b = ((1.0 - alpha) * 255.0 + alpha * (pixel[2] as f32)).round() as u8;
        rgb.put_pixel(x, y, image::Rgb([r, g, b]));
    }
    DynamicImage::ImageRgb8(rgb)
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
            return Ok((base64::engine::general_purpose::STANDARD.encode(bytes), media));
        }
    }
    let image = image::load_from_memory(bytes)
        .map_err(|e| AppError::other(format!("cannot decode image: {e}")))?;
    let (width, height) = image.dimensions();
    let resized = if width > max_dimension || height > max_dimension {
        image.thumbnail(max_dimension, max_dimension)
    } else {
        image
    };
    let mut cursor = Cursor::new(Vec::new());
    resized
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| AppError::other(format!("image encode failed: {e}")))?;
    Ok((base64::engine::general_purpose::STANDARD.encode(cursor.into_inner()), ImageMediaType::PNG))
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
    image::image_dimensions(&mut Cursor::new(bytes)).ok()
}
