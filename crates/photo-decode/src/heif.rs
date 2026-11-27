//! HEIC / HEIF through heic-rs. The container is probed first (no pixels), so a file declaring
//! more than the limits allow is refused before anything is allocated for it; the decode then
//! carries the same pixel cap as a second guard.
//!
//! Single-threaded: heic-rs's `parallel` feature is off. A photograph is a grid of independent
//! 512x512 tiles (heic-rs `Grid`); fanning those out across a Vortex worker pool, once Vortex can
//! host a wasm decode, is where a speed-up lives (heic-rs measures 3.6x on 4 tiles natively).

use crate::outcome::{Depth, Found, Limits, Refusal};
use heic_rs::{DecodeOptions, Error, ImageInfo, PixelLayout};

pub fn decode(bytes: &[u8], limits: &Limits, depth: Depth) -> Result<Found, Refusal> {
    let info: ImageInfo = heic_rs::probe(bytes).map_err(|e| refusal(e, None))?;
    // The coded size is what the decoder allocates; the output size is what the page draws.
    limits.check(info.coded_width, info.coded_height)?;
    limits.check(info.width, info.height)?;
    if depth == Depth::Probe {
        return Ok(Found::Fits {
            width: info.width,
            height: info.height,
            native: true,
        });
    }
    let options = DecodeOptions {
        layout: PixelLayout::Rgba8,
        max_pixels: Some(limits.max_pixels),
        ..DecodeOptions::default()
    };
    let image = heic_rs::decode(bytes, &options).map_err(|e| refusal(e, Some(&info)))?;
    let opaque = image.data.as_chunks::<4>().0.iter().all(|px| px[3] == 255);
    Ok(Found::Rgba {
        width: image.width,
        height: image.height,
        // heic-rs applies the file's rotation and mirror itself.
        orientation: 1,
        opaque,
        data: image.data,
    })
}

/// heic-rs's error as a refusal. A pixel-limit error after the probe passed means a derived
/// image (a grid) was larger than its declared size: refused at the size the file declared.
fn refusal(error: Error, info: Option<&ImageInfo>) -> Refusal {
    match (error, info) {
        (Error::PixelLimit { .. }, Some(info)) => Refusal::TooLarge {
            width: info.coded_width,
            height: info.coded_height,
        },
        (Error::Unsupported(what), _) => Refusal::Unsupported(what.to_string()),
        (other, _) => Refusal::Malformed(other.to_string()),
    }
}
