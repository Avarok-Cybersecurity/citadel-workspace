//! Camera RAW files are TIFF containers holding a thumbnail, JPEG previews and sensor data. These
//! build each maker's shape around the generated JPEG (tests/common) and check that the largest
//! drawable preview within the limits is cut out, and that sensor data is never taken for one.

mod common;

use common::*;
use photo_decode::decode;
use photo_decode::outcome::{Depth, Found, Limits, Refusal};

fn jpeg_of(found: Result<Found, Refusal>) -> (u32, u32, u8, Vec<u8>) {
    match found {
        Ok(Found::Jpeg {
            width,
            height,
            orientation,
            data,
        }) => (width, height, orientation, data),
        other => panic!("expected a JPEG preview, got {other:?}"),
    }
}

/// DNG: IFD0 a small RGB thumbnail, a SubIFD of lossless sensor data, a SubIFD JPEG preview.
fn dng(preview: &[u8], orientation: u32) -> Vec<u8> {
    let thumb = vec![128u8; 4 * 4 * 3];
    let sensor = lossless_jpeg(6000, 4000);
    let blobs: [&[u8]; 3] = [&thumb, &sensor, preview];
    let at = blob_offsets(&blobs);
    let mut ifd0 = rgb_strip(4, 4, at[0]);
    ifd0.push((0x0112, vec![orientation]));
    let raw = jpeg_strip(7, 6000, 4000, at[1], sensor.len() as u32);
    let shown = jpeg_strip(7, 48, 48, at[2], preview.len() as u32);
    build(false, &blobs, vec![ifd0], vec![(0, raw), (0, shown)])
}

#[test]
fn a_dng_shows_its_jpeg_preview_turned_as_the_file_asks() {
    let preview = fixture("quadrants-48.jpg");
    let (w, h, orientation, data) = jpeg_of(decode(&dng(&preview, 6), &LIMITS, Depth::Probe));
    assert_eq!((w, h, orientation), (48, 48, 6));
    assert_eq!(
        data,
        preview_handed_on(),
        "the preview's bytes, less its Exif"
    );
}

#[test]
fn a_cr2_shows_the_jpeg_in_its_first_directory() {
    let preview = fixture("quadrants-48.jpg");
    let marker = b"CR\x02\0\0\0\0\0".to_vec();
    let blobs: [&[u8]; 2] = [&marker, &preview];
    let at = blob_offsets(&blobs);
    let ifd0 = jpeg_strip(6, 48, 48, at[1], preview.len() as u32);
    let file = build(false, &blobs, vec![ifd0], vec![]);
    assert_eq!(&file[8..10], b"CR");
    assert_eq!(
        jpeg_of(decode(&file, &LIMITS, Depth::Pixels)).3,
        preview_handed_on()
    );
}

#[test]
fn a_big_endian_nef_shows_its_jpg_from_raw() {
    let preview = fixture("quadrants-48.jpg");
    let thumb = vec![0u8; 8 * 8 * 3];
    let blobs: [&[u8]; 2] = [&thumb, &preview];
    let at = blob_offsets(&blobs);
    let sub: Dir = vec![(0x0201, vec![at[1]]), (0x0202, vec![preview.len() as u32])];
    let file = build(true, &blobs, vec![rgb_strip(8, 8, at[0])], vec![(0, sub)]);
    let (w, h, orientation, data) = jpeg_of(decode(&file, &LIMITS, Depth::Pixels));
    assert_eq!((w, h, orientation, data), (48, 48, 1, preview_handed_on()));
}

#[test]
fn an_arw_shows_the_jpeg_its_first_directory_points_at() {
    let preview = fixture("quadrants-48.jpg");
    let thumb = vec![0u8; 2 * 2 * 3];
    let blobs: [&[u8]; 2] = [&thumb, &preview];
    let at = blob_offsets(&blobs);
    let mut ifd0 = rgb_strip(2, 2, at[0]);
    ifd0.extend([(0x0201, vec![at[1]]), (0x0202, vec![preview.len() as u32])]);
    let file = build(false, &blobs, vec![ifd0, rgb_strip(2, 2, at[0])], vec![]);
    assert_eq!(
        jpeg_of(decode(&file, &LIMITS, Depth::Pixels)).3,
        preview_handed_on()
    );
}

#[test]
fn a_preview_over_the_limits_gives_way_to_a_smaller_one_that_fits() {
    let file = dng(&jpeg_declaring(9000, 6000), 1);
    let tight = Limits {
        max_pixels: 40_000_000,
        max_edge: 8000,
    };
    match decode(&file, &tight, Depth::Pixels) {
        // The RGB thumbnail is the largest picture within the limits.
        Ok(Found::Rgba {
            width: 4,
            height: 4,
            data,
            ..
        }) => assert_eq!(data, [128, 128, 128, 255].repeat(16)),
        other => panic!("expected the thumbnail, got {other:?}"),
    }
}

#[test]
fn a_raw_with_nothing_within_the_limits_is_refused_at_its_largest_picture() {
    let file = dng(&jpeg_declaring(9000, 6000), 1);
    let tight = Limits {
        max_pixels: 15,
        max_edge: 16_384,
    };
    assert_eq!(
        decode(&file, &tight, Depth::Probe),
        Err(Refusal::TooLarge {
            width: 9000,
            height: 6000
        })
    );
}

#[test]
fn sensor_data_is_never_taken_for_a_preview() {
    let sensor = lossless_jpeg(48, 48);
    let blobs: [&[u8]; 1] = [&sensor];
    let at = blob_offsets(&blobs);
    let file = build(
        false,
        &blobs,
        vec![jpeg_strip(7, 48, 48, at[0], sensor.len() as u32)],
        vec![],
    );
    assert!(matches!(
        decode(&file, &LIMITS, Depth::Pixels),
        Err(Refusal::Unsupported(_))
    ));
}

#[test]
fn an_abbreviated_jpeg_without_its_tables_is_not_taken() {
    let full = fixture("quadrants-48.jpg");
    let dqt = full
        .windows(2)
        .position(|w| w == [0xFF, 0xDB])
        .expect("DQT");
    let length = usize::from(u16::from_be_bytes([full[dqt + 2], full[dqt + 3]]));
    let mut abbreviated = full[..dqt].to_vec();
    abbreviated.extend_from_slice(&full[dqt + 2 + length..]);
    // Every DQT goes: there may be more than one.
    while let Some(next) = abbreviated.windows(2).position(|w| w == [0xFF, 0xDB]) {
        let length = usize::from(u16::from_be_bytes([
            abbreviated[next + 2],
            abbreviated[next + 3],
        ]));
        abbreviated.drain(next..next + 2 + length);
    }
    let blobs: [&[u8]; 1] = [&abbreviated];
    let at = blob_offsets(&blobs);
    let file = build(
        false,
        &blobs,
        vec![jpeg_strip(7, 48, 48, at[0], abbreviated.len() as u32)],
        vec![],
    );
    assert!(matches!(
        decode(&file, &LIMITS, Depth::Pixels),
        Err(Refusal::Unsupported(_))
    ));
}
