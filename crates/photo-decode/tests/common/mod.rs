//! Builds TIFF containers byte by byte, in the shapes camera RAW files use: the fixtures for the
//! RAW-preview tests are made here from the generated JPEG, so no camera file is committed.
#![allow(dead_code)]

use photo_decode::outcome::Limits;

pub const LIMITS: Limits = Limits {
    max_pixels: 40_000_000,
    max_edge: 16_384,
};

pub fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("fixture")
}

/// One directory: (tag, LONG values). SubIFDs are given separately and linked by the builder.
pub type Dir = Vec<(u16, Vec<u32>)>;

/// Where `blobs` land when built: one after another from byte 8, each padded to even length.
pub fn blob_offsets(blobs: &[&[u8]]) -> Vec<u32> {
    let mut at = 8u32;
    blobs
        .iter()
        .map(|b| {
            let here = at;
            at += (b.len() as u32 + 1) & !1;
            here
        })
        .collect()
}

/// A TIFF: header, the blobs, then `chain` (linked in order) and each `(parent, dir)` in `subs`,
/// linked from its parent's SubIFDs tag. A first blob of b"CR\x02\0..." makes it CR2-shaped.
pub fn build(
    big_endian: bool,
    blobs: &[&[u8]],
    chain: Vec<Dir>,
    subs: Vec<(usize, Dir)>,
) -> Vec<u8> {
    let w16 = |v: u16| {
        if big_endian {
            v.to_be_bytes()
        } else {
            v.to_le_bytes()
        }
    };
    let w32 = |v: u32| {
        if big_endian {
            v.to_be_bytes()
        } else {
            v.to_le_bytes()
        }
    };
    let mut out: Vec<u8> = if big_endian {
        b"MM\0*".to_vec()
    } else {
        b"II*\0".to_vec()
    };
    out.extend_from_slice(&[0; 4]);
    for blob in blobs {
        out.extend_from_slice(blob);
        if blob.len() % 2 == 1 {
            out.push(0);
        }
    }
    let mut dirs: Vec<Dir> = chain.clone();
    dirs.extend(subs.iter().map(|(_, d)| d.clone()));
    for (i, _) in chain.iter().enumerate() {
        let count = subs.iter().filter(|(p, _)| *p == i).count();
        if count > 0 {
            dirs[i].push((0x014A, vec![0; count]));
        }
    }
    let size = |d: &Dir| {
        2 + d.len() * 12
            + 4
            + d.iter()
                .map(|(_, v)| if v.len() > 1 { v.len() * 4 } else { 0 })
                .sum::<usize>()
    };
    let mut offsets = Vec::new();
    let mut at = out.len();
    for d in &dirs {
        offsets.push(at as u32);
        at += size(d);
    }
    for (i, _) in chain.iter().enumerate() {
        let mine: Vec<u32> = subs
            .iter()
            .enumerate()
            .filter(|(_, (p, _))| *p == i)
            .map(|(k, _)| offsets[chain.len() + k])
            .collect();
        if let Some(entry) = dirs[i].iter_mut().find(|(t, _)| *t == 0x014A) {
            entry.1 = mine;
        }
    }
    let first = offsets[0];
    out[4..8].copy_from_slice(&w32(first));
    for (i, d) in dirs.iter().enumerate() {
        let mut sorted = d.clone();
        sorted.sort_by_key(|(t, _)| *t);
        let base = offsets[i] as usize;
        let mut extra = base + 2 + sorted.len() * 12 + 4;
        out.extend_from_slice(&w16(sorted.len() as u16));
        let mut tail = Vec::new();
        for (tag, values) in &sorted {
            out.extend_from_slice(&w16(*tag));
            out.extend_from_slice(&w16(4));
            out.extend_from_slice(&w32(values.len() as u32));
            if values.len() == 1 {
                out.extend_from_slice(&w32(values[0]));
            } else {
                out.extend_from_slice(&w32(extra as u32));
                for v in values {
                    tail.extend_from_slice(&w32(*v));
                }
                extra += values.len() * 4;
            }
        }
        let next = if i + 1 < chain.len() {
            offsets[i + 1]
        } else {
            0
        };
        out.extend_from_slice(&w32(next));
        out.extend_from_slice(&tail);
    }
    out
}

/// An uncompressed 8-bit RGB thumbnail directory for `pixels` at `offset`.
pub fn rgb_strip(width: u32, height: u32, offset: u32) -> Dir {
    vec![
        (0x00FE, vec![1]),
        (0x0100, vec![width]),
        (0x0101, vec![height]),
        (0x0102, vec![8, 8, 8]),
        (0x0103, vec![1]),
        (0x0106, vec![2]),
        (0x0111, vec![offset]),
        (0x0115, vec![3]),
        (0x0116, vec![height]),
        (0x0117, vec![width.saturating_mul(height).saturating_mul(3)]),
    ]
}

/// A directory whose single strip is a JPEG (`compression` 6 or 7).
pub fn jpeg_strip(compression: u32, width: u32, height: u32, offset: u32, length: u32) -> Dir {
    vec![
        (0x0100, vec![width]),
        (0x0101, vec![height]),
        (0x0103, vec![compression]),
        (0x0111, vec![offset]),
        (0x0117, vec![length]),
    ]
}

/// A lossless (SOF3) JPEG header declaring `width` x `height`: what RAW sensor data looks like.
pub fn lossless_jpeg(width: u16, height: u16) -> Vec<u8> {
    let mut j = vec![0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x43, 0x00];
    j.extend_from_slice(&[1; 64]);
    j.extend_from_slice(&[0xFF, 0xC3, 0x00, 0x0B, 0x08]);
    j.extend_from_slice(&height.to_be_bytes());
    j.extend_from_slice(&width.to_be_bytes());
    j.extend_from_slice(&[0x01, 0x01, 0x11, 0x00]);
    // A scan header, so only the frame type can keep it from being taken.
    j.extend_from_slice(&[
        0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xFF, 0xD9,
    ]);
    j
}

/// The generated JPEG with its frame's declared size rewritten (to test the limits on a preview).
pub fn jpeg_declaring(width: u16, height: u16) -> Vec<u8> {
    let mut j = fixture("quadrants-48.jpg");
    let sof = j
        .windows(2)
        .position(|w| w == [0xFF, 0xC0])
        .expect("baseline SOF0");
    j[sof + 5..sof + 7].copy_from_slice(&height.to_be_bytes());
    j[sof + 7..sof + 9].copy_from_slice(&width.to_be_bytes());
    j
}

/// quadrants-48.jpg as a RAW preview is handed on: without the Exif segment sips writes after
/// JFIF (bytes 20..98), every other byte as written. Sliced by position, not by the code tested.
pub fn preview_handed_on() -> Vec<u8> {
    let jpeg = fixture("quadrants-48.jpg");
    assert_eq!(&jpeg[20..22], &[0xFF, 0xE1]);
    assert_eq!(&jpeg[24..30], b"Exif\0\0");
    [&jpeg[..20], &jpeg[98..]].concat()
}
