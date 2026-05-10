use std::path::{Path, PathBuf};

use image::{imageops::FilterType, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize, Clone)]
pub struct CompressOptions {
    /// Max width in px. Image's longer side is capped at this if it exceeds.
    pub max_width: Option<u32>,
    /// Output quality 1..=100 for JPEG/WebP.
    pub quality: Option<u8>,
    /// One of "jpeg", "webp", "png", "keep".
    pub format: Option<String>,
}

impl Default for CompressOptions {
    fn default() -> Self {
        Self {
            max_width: Some(2000),
            quality: Some(85),
            format: Some("keep".into()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CompressResult {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub bytes_before: u64,
    pub bytes_after: u64,
    pub format: String,
}

/// Compress `src` and write to `dst`. `dst` extension may change based on format.
/// Returns the actual output path.
pub fn compress(src: &Path, dst: &Path, opts: &CompressOptions) -> AppResult<CompressResult> {
    let bytes_before = std::fs::metadata(src)?.len();
    let reader = ImageReader::open(src)?.with_guessed_format()?;
    let src_format = reader.format();
    let img = reader.decode()?;

    let max_w = opts.max_width.unwrap_or(2000);
    let (w, h) = (img.width(), img.height());
    let resized = if w.max(h) > max_w {
        let scale = max_w as f32 / w.max(h) as f32;
        let nw = (w as f32 * scale).round() as u32;
        let nh = (h as f32 * scale).round() as u32;
        img.resize(nw, nh, FilterType::Lanczos3)
    } else {
        img
    };

    let format_choice = opts.format.as_deref().unwrap_or("keep");
    let (out_format, out_ext) = resolve_format(format_choice, src_format, dst);
    let mut final_dst = dst.to_path_buf();
    final_dst.set_extension(out_ext);

    let quality = opts.quality.unwrap_or(85).clamp(1, 100);

    // Use intermediate buffer so we can apply quality settings for JPEG.
    use std::io::BufWriter;
    let file = std::fs::File::create(&final_dst)?;
    let mut writer = BufWriter::new(file);

    match out_format {
        ImageFormat::Jpeg => {
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, quality);
            enc.encode_image(&resized)?;
        }
        ImageFormat::WebP => {
            // image crate's webp encoder only supports lossless. For lossy we'd
            // need the `webp` crate, but to keep deps minimal we fall back to
            // lossless WebP. Users wanting smaller files should pick JPEG.
            let enc = image::codecs::webp::WebPEncoder::new_lossless(&mut writer);
            resized.write_with_encoder(enc)?;
        }
        ImageFormat::Png => {
            let enc = image::codecs::png::PngEncoder::new_with_quality(
                &mut writer,
                image::codecs::png::CompressionType::Best,
                image::codecs::png::FilterType::Adaptive,
            );
            resized.write_with_encoder(enc)?;
        }
        other => {
            resized.write_to(&mut writer, other)?;
        }
    }
    drop(writer);

    let bytes_after = std::fs::metadata(&final_dst)?.len();
    Ok(CompressResult {
        path: final_dst,
        width: resized.width(),
        height: resized.height(),
        bytes_before,
        bytes_after,
        format: format_ext_name(out_format).to_string(),
    })
}

fn resolve_format(choice: &str, src_format: Option<ImageFormat>, dst: &Path) -> (ImageFormat, &'static str) {
    match choice.to_ascii_lowercase().as_str() {
        "jpeg" | "jpg" => (ImageFormat::Jpeg, "jpg"),
        "webp" => (ImageFormat::WebP, "webp"),
        "png" => (ImageFormat::Png, "png"),
        "keep" | "" => {
            let by_ext = dst
                .extension()
                .and_then(|s| s.to_str())
                .and_then(|e| ImageFormat::from_extension(e));
            let fmt = by_ext.or(src_format).unwrap_or(ImageFormat::Jpeg);
            (fmt, format_ext_name(fmt))
        }
        other => {
            // Unknown — try parsing as a format name.
            let fmt = ImageFormat::from_extension(other).unwrap_or(ImageFormat::Jpeg);
            (fmt, format_ext_name(fmt))
        }
    }
}

fn format_ext_name(fmt: ImageFormat) -> &'static str {
    match fmt {
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Png => "png",
        ImageFormat::WebP => "webp",
        ImageFormat::Gif => "gif",
        ImageFormat::Bmp => "bmp",
        ImageFormat::Tiff => "tiff",
        _ => "bin",
    }
}

/// Import an external image into a bundle directory. Compresses and stores
/// using `desired_stem.<ext>`. If a name collision exists, suffixes with -1, -2, etc.
/// Returns (relative filename, compress result).
pub fn import_into_bundle(
    src: &Path,
    bundle_dir: &Path,
    desired_stem: Option<&str>,
    opts: &CompressOptions,
) -> AppResult<(String, CompressResult)> {
    if !bundle_dir.is_dir() {
        return Err(AppError::msg(format!(
            "bundle dir does not exist: {}",
            bundle_dir.display()
        )));
    }
    let stem = desired_stem
        .map(|s| sanitize_stem(s))
        .unwrap_or_else(|| {
            src.file_stem()
                .and_then(|s| s.to_str())
                .map(sanitize_stem)
                .unwrap_or_else(|| "image".into())
        });
    // Pick a tentative ext for the dst so resolve_format can use it if "keep".
    let tentative_ext = src.extension().and_then(|s| s.to_str()).unwrap_or("jpg");
    let mut candidate = bundle_dir.join(format!("{stem}.{tentative_ext}"));
    let mut suffix = 1;
    while candidate.exists() {
        candidate = bundle_dir.join(format!("{stem}-{suffix}.{tentative_ext}"));
        suffix += 1;
    }
    let result = compress(src, &candidate, opts)?;
    let rel = result
        .path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    Ok((rel, result))
}

fn sanitize_stem(s: impl AsRef<str>) -> String {
    let s = s.as_ref().trim();
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch.to_ascii_lowercase());
        } else if ch.is_whitespace() {
            out.push('-');
        }
    }
    if out.is_empty() {
        out.push_str("image");
    }
    out
}
