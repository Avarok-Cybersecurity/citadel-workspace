//! Whether a byte range is a JPEG a browser draws, and its size: the first start-of-frame
//! marker must be baseline (SOF0), extended (SOF1) or progressive (SOF2) at 8 bits with one or
//! three components. A RAW file's sensor data is often lossless JPEG (SOF3), which no browser
//! decodes, so it is never taken for a preview. Nor is an abbreviated stream (no quantisation
//! table before its first scan, as JPEG-in-TIFF strips that lean on the file's JPEGTables are).

/// Width and height of a drawable JPEG, or `None`. Read up to its first scan: the frame and the
/// quantisation tables may come in either order (Apple's encoder writes the frame first).
pub fn drawable_size(jpeg: &[u8]) -> Option<(u32, u32)> {
    if jpeg.get(0..3)? != [0xFF, 0xD8, 0xFF] {
        return None;
    }
    let mut at = 2usize;
    let mut tables = false;
    let mut size = None;
    loop {
        if *jpeg.get(at)? != 0xFF {
            return None;
        }
        let marker = *jpeg.get(at + 1)?;
        match marker {
            0xFF => at += 1,
            // Standalone markers (TEM, RST0-7) have no length.
            0x01 | 0xD0..=0xD7 => at += 2,
            // Any frame type but baseline, extended and progressive is not drawable.
            0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF => return None,
            // The first scan: drawable when a frame and its tables came before it.
            0xDA => return if tables { size } else { None },
            0xD9 => return None,
            _ => {
                let length =
                    usize::from(u16::from_be_bytes([*jpeg.get(at + 2)?, *jpeg.get(at + 3)?]));
                if length < 2 {
                    return None;
                }
                match marker {
                    0xC0..=0xC2 if size.is_none() => size = Some(frame(jpeg, at)?),
                    0xDB => tables = true,
                    _ => {}
                }
                at = at.checked_add(2 + length)?;
            }
        }
    }
}

fn frame(jpeg: &[u8], at: usize) -> Option<(u32, u32)> {
    let segment = jpeg.get(at + 4..at + 10)?;
    let precision = segment[0];
    let height = u32::from(u16::from_be_bytes([segment[1], segment[2]]));
    let width = u32::from(u16::from_be_bytes([segment[3], segment[4]]));
    let components = segment[5];
    (precision == 8 && (components == 1 || components == 3) && width > 0 && height > 0)
        .then_some((width, height))
}
