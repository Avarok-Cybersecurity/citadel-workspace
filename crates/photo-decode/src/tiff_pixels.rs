//! A TIFF image to straight RGBA through the `tiff` crate, for the layouts tiff_pick.rs accepts.
//! The size was checked against the limits before this runs; the crate's own buffer limit is set
//! from the same numbers as a second guard.

use crate::outcome::{Limits, Refusal};
use std::io::Cursor;
use tiff::decoder::{Decoder, DecodingResult, Limits as TiffLimits};
use tiff::{ColorType, TiffError};

pub fn rgba(
    bytes: &[u8],
    index: usize,
    limits: &Limits,
) -> Result<(u32, u32, bool, Vec<u8>), Refusal> {
    // 4 channels of 16 bits is the most a picked layout stores per pixel.
    let buffer = usize::try_from(limits.max_pixels.saturating_mul(8)).unwrap_or(usize::MAX);
    let mut caps = TiffLimits::default();
    caps.decoding_buffer_size = buffer;
    caps.intermediate_buffer_size = buffer;
    let mut decoder = Decoder::new(Cursor::new(bytes))
        .map_err(refusal)?
        .with_limits(caps);
    decoder.seek_to_image(index).map_err(refusal)?;
    let (width, height) = decoder.dimensions().map_err(refusal)?;
    limits.check(width, height)?;
    let channels = match decoder.colortype().map_err(refusal)? {
        ColorType::Gray(_) => 1,
        ColorType::GrayA(_) => 2,
        ColorType::RGB(_) => 3,
        ColorType::RGBA(_) => 4,
        other => {
            return Err(Refusal::Unsupported(format!(
                "its colour layout ({other:?}) is not read here"
            )))
        }
    };
    let samples: Vec<u8> = match decoder.read_image().map_err(refusal)? {
        DecodingResult::U8(v) => v,
        // The high byte of each 16-bit sample: a preview is drawn at 8 bits.
        DecodingResult::U16(v) => v.into_iter().map(|s| (s >> 8) as u8).collect(),
        _ => {
            return Err(Refusal::Unsupported(
                "its sample format is not 8 or 16-bit integers".into(),
            ))
        }
    };
    let pixels = (width as usize) * (height as usize);
    if samples.len() < pixels * channels {
        return Err(Refusal::Malformed(
            "its image data is shorter than its size".into(),
        ));
    }
    let mut data = Vec::with_capacity(pixels * 4);
    for px in samples.chunks_exact(channels).take(pixels) {
        let (r, g, b, a) = match channels {
            1 => (px[0], px[0], px[0], 255),
            2 => (px[0], px[0], px[0], px[1]),
            3 => (px[0], px[1], px[2], 255),
            _ => (px[0], px[1], px[2], px[3]),
        };
        data.extend_from_slice(&[r, g, b, a]);
    }
    let opaque = channels % 2 == 1 || data.as_chunks::<4>().0.iter().all(|px| px[3] == 255);
    Ok((width, height, opaque, data))
}

fn refusal(error: TiffError) -> Refusal {
    match error {
        TiffError::UnsupportedError(what) => Refusal::Unsupported(what.to_string()),
        TiffError::LimitsExceeded => {
            Refusal::Malformed("it needs more memory than its size allows".into())
        }
        other => Refusal::Malformed(other.to_string()),
    }
}
