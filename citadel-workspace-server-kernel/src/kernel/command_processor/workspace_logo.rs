//! What a workspace icon may be: a small raster image, as a data URL.
//!
//! The icon is shown in every member's workspace switcher and top bar, so it is held to what an
//! `<img>` can show safely and cheaply:
//! - WebP, PNG or JPEG only. SVG is refused because it can carry script, and anything else is
//!   refused because nothing renders it reliably.
//! - At most MAX_LOGO_BYTES once decoded. It rides in the workspace record, which every member
//!   receives on every workspace broadcast.
//! - Its first bytes must be the declared format's signature, so a data URL cannot claim to be a
//!   PNG while holding something else.

use base64::Engine;

/// Decoded size limit. The client resizes to 128 px WebP, which is well under this.
pub const MAX_LOGO_BYTES: usize = 32 * 1024;

/// Whether decoded bytes begin with a format's signature.
type Signature = fn(&[u8]) -> bool;

const FORMATS: [(&str, Signature); 3] = [
    ("image/webp", |b| {
        b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP"
    }),
    ("image/png", |b| b.starts_with(b"\x89PNG\r\n\x1a\n")),
    ("image/jpeg", |b| b.starts_with(&[0xFF, 0xD8, 0xFF])),
];

/// Ok when `data_url` is an icon this workspace may store.
pub fn validate_logo(data_url: &str) -> Result<(), String> {
    let rest = data_url
        .strip_prefix("data:")
        .ok_or("The icon must be an image data URL")?;
    let (mime, payload) = rest
        .split_once(";base64,")
        .ok_or("The icon must be a base64 image data URL")?;
    let (_, matches_signature) = FORMATS
        .iter()
        .find(|(m, _)| *m == mime)
        .ok_or("The icon must be a WebP, PNG or JPEG image")?;
    // Bounded before decoding, so an oversized payload is refused without allocating for it.
    if payload.len() > MAX_LOGO_BYTES.div_ceil(3) * 4 {
        return Err(format!(
            "The icon must be at most {} KB",
            MAX_LOGO_BYTES / 1024
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|_| "The icon is not valid base64".to_string())?;
    if bytes.len() > MAX_LOGO_BYTES {
        return Err(format!(
            "The icon must be at most {} KB",
            MAX_LOGO_BYTES / 1024
        ));
    }
    if !matches_signature(&bytes) {
        return Err("The icon's contents do not match its image type".to_string());
    }
    Ok(())
}
