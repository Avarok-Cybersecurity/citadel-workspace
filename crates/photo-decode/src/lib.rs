//! photo-decode: previews of the photo formats a browser may not draw itself. Bytes in, and out
//! either the size (a probe), straight RGBA, or a JPEG cut out of the file; never I/O. The page
//! (citadel-workspaces/src/lib/photo-decode) runs it in a Web Worker and turns the answer into a
//! picture, so the formats it already draws never reach this module.
//!
//! - HEIC / HEIF (iPhone photos): heic-rs.
//! - TIFF (scans, exports): the `tiff` crate, LZW / Deflate / PackBits, grey or RGB.
//! - Camera RAW in a TIFF container (DNG, CR2, NEF, ARW, and others built the same way): the
//!   largest JPEG preview inside, drawn by the browser; the sensor data is never developed.
//!
//! Every path checks the declared size against the page's limits before allocating pixels.

#![forbid(unsafe_code)]

mod heif;
mod jpeg_sof;
pub mod outcome;
mod tiff_ifd;
mod tiff_pick;
mod tiff_pixels;
mod wasm;

use outcome::{Depth, Found, Limits, Refusal};
use tiff_pick::Candidate;

/// The container a file's first bytes declare.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    /// ISO-BMFF with a HEIF brand.
    Heif,
    /// TIFF, either byte order (TIFF itself, and the RAW formats built on it).
    Tiff,
}

/// HEIF major brands: HEVC images and sequences, and the generic image brand some writers use.
const HEIF_BRANDS: [&[u8; 4]; 8] = [
    b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1",
];

pub fn container(bytes: &[u8]) -> Option<Container> {
    match bytes.get(0..4)? {
        [b'I', b'I', 42, 0] | [b'M', b'M', 0, 42] => return Some(Container::Tiff),
        _ => {}
    }
    let (ftyp, brand) = (bytes.get(4..8)?, bytes.get(8..12)?);
    (ftyp == b"ftyp" && HEIF_BRANDS.iter().any(|b| brand == *b)).then_some(Container::Heif)
}

/// The picture in `bytes`, to `depth`, within `limits`.
pub fn decode(bytes: &[u8], limits: &Limits, depth: Depth) -> Result<Found, Refusal> {
    match container(bytes) {
        Some(Container::Heif) => heif::decode(bytes, limits, depth),
        Some(Container::Tiff) => tiff(bytes, limits, depth),
        None => Err(Refusal::Malformed(
            "it is not a HEIC, HEIF or TIFF file".into(),
        )),
    }
}

fn tiff(bytes: &[u8], limits: &Limits, depth: Depth) -> Result<Found, Refusal> {
    let file = tiff_ifd::Tiff::open(bytes)
        .ok_or_else(|| Refusal::Malformed("its TIFF header cannot be read".into()))?;
    match tiff_pick::pick(&file, limits)? {
        (
            Candidate::Jpeg {
                width,
                height,
                start,
                end,
            },
            orientation,
        ) => Ok(Found::Jpeg {
            width,
            height,
            orientation,
            data: bytes[start..end].to_vec(),
        }),
        (
            Candidate::Strips {
                width,
                height,
                index,
            },
            _,
        ) if depth == Depth::Probe => Ok(Found::Fits {
            width,
            height,
            // A browser that reads TIFF draws the first image; any other one must be decoded here.
            native: index == 0,
        }),
        (Candidate::Strips { index, .. }, orientation) => {
            let (width, height, opaque, data) = tiff_pixels::rgba(bytes, index, limits)?;
            Ok(Found::Rgba {
                width,
                height,
                orientation,
                opaque,
                data,
            })
        }
    }
}
