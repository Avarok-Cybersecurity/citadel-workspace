//! Which picture inside a TIFF file to show. A scan or an exported TIFF is one image; a camera
//! RAW (DNG, CR2, NEF, ARW) holds a tiny thumbnail, one or more JPEG previews, and sensor data a
//! browser cannot draw. Every candidate is listed, those over the limits are dropped, and the
//! largest left is shown, a JPEG preferred on a tie (the browser decodes it). Pure.

use crate::jpeg_sof::drawable_size;
use crate::outcome::{Limits, Refusal};
use crate::tiff_ifd::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Candidate {
    /// A drawable JPEG at `bytes[start..end]`.
    Jpeg {
        width: u32,
        height: u32,
        start: usize,
        end: usize,
    },
    /// The main chain's image `index`, in a layout tiff_pixels.rs decodes.
    Strips {
        width: u32,
        height: u32,
        index: usize,
    },
}

impl Candidate {
    fn size(&self) -> (u32, u32) {
        match *self {
            Candidate::Jpeg { width, height, .. } | Candidate::Strips { width, height, .. } => {
                (width, height)
            }
        }
    }

    fn area(&self) -> u64 {
        let (w, h) = self.size();
        u64::from(w) * u64::from(h)
    }
}

/// The picture to show, and the orientation the file's first directory asks for (1 when absent).
pub fn pick(tiff: &Tiff, limits: &Limits) -> Result<(Candidate, u8), Refusal> {
    let directories = tiff.directories();
    if directories.is_empty() {
        return Err(Refusal::Malformed(
            "its first image directory cannot be read".into(),
        ));
    }
    let orientation = directories[0]
        .first(ORIENTATION)
        .filter(|o| (1..=8).contains(o))
        .unwrap_or(1) as u8;
    let all: Vec<Candidate> = directories
        .iter()
        .flat_map(|d| candidates(tiff, d))
        .collect();
    let largest = all.iter().max_by_key(|c| c.area()).cloned();
    let best = all
        .into_iter()
        .filter(|c| {
            let (w, h) = c.size();
            limits.fits(w, h)
        })
        .max_by_key(|c| (c.area(), matches!(c, Candidate::Jpeg { .. })));
    match (best, largest) {
        (Some(best), _) => Ok((best, orientation)),
        (None, Some(largest)) => {
            let (width, height) = largest.size();
            Err(Refusal::TooLarge { width, height })
        }
        (None, None) => Err(Refusal::Unsupported(
            "it holds no picture in a layout this decoder reads (8- or 16-bit grey or RGB, uncompressed, LZW, Deflate or PackBits, or a JPEG preview)".into(),
        )),
    }
}

fn candidates(tiff: &Tiff, dir: &Directory) -> Vec<Candidate> {
    let mut out = Vec::new();
    if let (Some(offset), Some(length)) = (dir.first(JPEG_OFFSET), dir.first(JPEG_LENGTH)) {
        out.extend(jpeg_at(tiff, offset, length));
    }
    let compression = dir.first(COMPRESSION).unwrap_or(1);
    let one_strip = |tag: u16| dir.values(tag).filter(|v| v.len() == 1).map(|v| v[0]);
    if compression == 6 || compression == 7 {
        if let (Some(offset), Some(length)) =
            (one_strip(STRIP_OFFSETS), one_strip(STRIP_BYTE_COUNTS))
        {
            out.extend(jpeg_at(tiff, offset, length));
        }
    }
    if let Some(strips) = strips(dir, compression) {
        out.push(strips);
    }
    out
}

fn jpeg_at(tiff: &Tiff, offset: u32, length: u32) -> Option<Candidate> {
    let start = usize::try_from(offset).ok()?;
    let end = start.checked_add(usize::try_from(length).ok()?)?;
    let (width, height) = drawable_size(tiff.bytes.get(start..end)?)?;
    Some(Candidate::Jpeg {
        width,
        height,
        start,
        end,
    })
}

/// A main-chain image in a layout tiff_pixels.rs decodes: chunky grey or RGB (with or without
/// alpha), 8 or 16 bits, uncompressed, LZW, Deflate or PackBits.
fn strips(dir: &Directory, compression: u32) -> Option<Candidate> {
    let index = dir.chain_index?;
    let photometric = dir.first(PHOTOMETRIC)?;
    let samples = dir.first(SAMPLES_PER_PIXEL).unwrap_or(1);
    let bits = dir
        .values(BITS_PER_SAMPLE)
        .map(<[u32]>::to_vec)
        .unwrap_or_else(|| vec![1]);
    let layout_ok = matches!(compression, 1 | 5 | 8 | 32773 | 32946)
        && matches!((photometric, samples), (0 | 1, 1 | 2) | (2, 3 | 4))
        && dir.first(PLANAR_CONFIGURATION).unwrap_or(1) == 1
        && bits.iter().all(|&b| b == 8 || b == 16);
    let width = dir.first(IMAGE_WIDTH)?;
    let height = dir.first(IMAGE_LENGTH)?;
    layout_ok.then_some(Candidate::Strips {
        width,
        height,
        index,
    })
}
