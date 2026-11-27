//! A RAW's preview is turned upright by the RAW's own Orientation tag, once. Its embedded JPEG
//! may carry an Exif Orientation too; a browser applies that one by itself (createImageBitmap's
//! default, and CSS image-orientation on an <img>), so it is cut out of the preview handed on.
//! turned-6.dng says 6 in its first directory and in its JPEG's Exif (scripts/gen-turned.py).

mod common;

use common::*;
use photo_decode::decode;
use photo_decode::outcome::{Depth, Found};

const EXIF: &[u8] = b"Exif\0\0";

fn carries_exif(jpeg: &[u8]) -> bool {
    jpeg.windows(EXIF.len()).any(|w| w == EXIF)
}

#[test]
fn the_fixture_jpeg_carries_its_own_orientation() {
    assert!(carries_exif(&fixture("quadrants-48-exif6.jpg")));
    assert!(carries_exif(&fixture("turned-6.dng")));
}

fn preview_of(file: &[u8], depth: Depth) -> (u32, u32, u8, Vec<u8>) {
    match decode(file, &LIMITS, depth) {
        Ok(Found::Jpeg {
            width,
            height,
            orientation,
            data,
        }) => (width, height, orientation, data),
        other => panic!("expected a JPEG preview, got {other:?}"),
    }
}

fn dng_around(jpeg: &[u8], orientation: u32) -> Vec<u8> {
    let blobs: [&[u8]; 1] = [jpeg];
    let at = blob_offsets(&blobs);
    let ifd0 = vec![
        (0x0112, vec![orientation]),
        (0x0201, vec![at[0]]),
        (0x0202, vec![jpeg.len() as u32]),
    ];
    build(false, &blobs, vec![ifd0], vec![])
}

#[test]
fn a_raw_preview_is_turned_by_the_raw_alone() {
    for depth in [Depth::Probe, Depth::Pixels] {
        let (width, height, orientation, data) = preview_of(&fixture("turned-6.dng"), depth);
        assert_eq!((width, height, orientation), (48, 48, 6));
        assert!(
            !carries_exif(&data),
            "the JPEG's own orientation was handed on"
        );
        assert_eq!(&data[..2], &[0xFF, 0xD8]);
        // Only Exif segments go: ours (36 bytes, Orientation 6, right after SOI) and the one sips
        // writes after JFIF (78 bytes, no orientation). Everything else is byte for byte.
        let original = fixture("quadrants-48-exif6.jpg");
        let (ours, jfif, sips) = (36, 18, 78);
        let expected: Vec<u8> = [
            &original[..2],
            &original[2 + ours..2 + ours + jfif],
            &original[2 + ours + jfif + sips..],
        ]
        .concat();
        assert_eq!(data, expected);
    }
}

#[test]
fn a_raw_saying_upright_is_drawn_upright_whatever_its_jpeg_says() {
    let (_, _, orientation, data) = preview_of(
        &dng_around(&fixture("quadrants-48-exif6.jpg"), 1),
        Depth::Pixels,
    );
    assert_eq!(orientation, 1);
    assert!(!carries_exif(&data));
}

#[test]
fn a_preview_without_exif_is_handed_on_unchanged() {
    let (_, _, _, bare) = preview_of(&fixture("turned-6.dng"), Depth::Pixels);
    let (_, _, _, again) = preview_of(&dng_around(&bare, 1), Depth::Pixels);
    assert_eq!(again, bare);
}
