//! A RAW's JPEG preview without its own Exif segments. The RAW's first directory states the
//! orientation the preview is turned by (lib.rs hands it on); a browser would also apply an
//! Orientation in the JPEG's Exif by itself, in createImageBitmap and in CSS image-orientation,
//! so the preview would be turned twice, or turned when the RAW says it is upright.

const APP1: u8 = 0xE1;
const EXIF: &[u8] = b"Exif\0\0";

/// The JPEG with every Exif APP1 segment before its first scan removed; the rest byte for byte.
pub fn without_exif(jpeg: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(jpeg.len());
    let Some(head) = jpeg.get(0..2) else {
        return jpeg.to_vec();
    };
    out.extend_from_slice(head);
    let mut at = 2usize;
    while let (Some(&0xFF), Some(&marker)) = (jpeg.get(at), jpeg.get(at + 1)) {
        // Standalone markers, and the first scan: everything from here on is kept as it is.
        if marker == 0xDA
            || marker == 0xD9
            || marker == 0x01
            || (0xD0..=0xD7).contains(&marker)
            || marker == 0xFF
        {
            break;
        }
        let Some(length) = jpeg
            .get(at + 2..at + 4)
            .map(|b| usize::from(u16::from_be_bytes([b[0], b[1]])))
        else {
            break;
        };
        let Some(end) = at
            .checked_add(2 + length)
            .filter(|&end| length >= 2 && end <= jpeg.len())
        else {
            break;
        };
        let exif = marker == APP1
            && jpeg
                .get(at + 4..)
                .is_some_and(|rest| rest.starts_with(EXIF));
        if !exif {
            out.extend_from_slice(&jpeg[at..end]);
        }
        at = end;
    }
    out.extend_from_slice(jpeg.get(at..).unwrap_or_default());
    out
}
