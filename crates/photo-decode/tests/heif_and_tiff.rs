//! HEIC through heic-rs and TIFF through the `tiff` crate, on the generated fixtures
//! (tests/fixtures/PROVENANCE.md), and the limits refusing each before any pixel is allocated.

mod common;

use common::{fixture, LIMITS};
use photo_decode::outcome::{Depth, Found, Limits, Refusal};
use photo_decode::{container, decode, Container};

fn rgba(found: Found) -> (u32, u32, u8, bool, Vec<u8>) {
    match found {
        Found::Rgba {
            width,
            height,
            orientation,
            opaque,
            data,
        } => (width, height, orientation, opaque, data),
        other => panic!("expected pixels, got {other:?}"),
    }
}

fn png_rgb(name: &str) -> Vec<u8> {
    let decoder = png::Decoder::new(std::io::Cursor::new(fixture(name)));
    let mut reader = decoder.read_info().expect("png header");
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).expect("png frame");
    buf.truncate(info.buffer_size());
    buf
}

#[test]
fn the_container_is_named_by_its_first_bytes_only() {
    assert_eq!(
        container(&fixture("checker-64.heic")),
        Some(Container::Heif)
    );
    assert_eq!(
        container(&fixture("quadrants-48-lzw.tif")),
        Some(Container::Tiff)
    );
    assert_eq!(container(b"MM\0*\0\0\0\x08"), Some(Container::Tiff));
    assert_eq!(container(&fixture("quadrants-48.png")), None);
    assert_eq!(container(&fixture("quadrants-48.jpg")), None);
    assert_eq!(
        container(b"\0\0\0\x1cftypavif\0\0\0\0"),
        None,
        "AVIF is the browser's own"
    );
}

#[test]
fn a_heic_photo_decodes_to_what_apple_decodes_it_to() {
    let (w, h, orientation, opaque, data) =
        rgba(decode(&fixture("checker-64.heic"), &LIMITS, Depth::Pixels).expect("decodes"));
    assert_eq!((w, h, orientation, opaque), (64, 64, 1, true));
    let reference = png_rgb("checker-64.ref.png");
    assert_eq!(reference.len(), 64 * 64 * 3);
    let worst = data
        .as_chunks::<4>()
        .0
        .iter()
        .zip(reference.as_chunks::<3>().0)
        .flat_map(|(ours, apple)| (0..3).map(move |c| ours[c].abs_diff(apple[c])))
        .max()
        .unwrap();
    // HEVC is lossy and 4:2:0; GROUND-TRUTH.md in heic-rs measures a few code values of drift.
    assert!(
        worst <= 12,
        "worst channel difference from Apple's decode: {worst}"
    );
}

#[test]
fn a_heic_probe_reads_the_size_and_decodes_nothing() {
    assert_eq!(
        decode(&fixture("checker-64.heic"), &LIMITS, Depth::Probe),
        Ok(Found::Fits {
            width: 64,
            height: 64,
            native: true
        })
    );
}

#[test]
fn a_heic_over_the_pixel_cap_is_refused_before_decoding() {
    let tight = Limits {
        max_pixels: 64 * 64 - 1,
        max_edge: 16_384,
    };
    for depth in [Depth::Probe, Depth::Pixels] {
        assert_eq!(
            decode(&fixture("checker-64.heic"), &tight, depth),
            Err(Refusal::TooLarge {
                width: 64,
                height: 64
            })
        );
    }
}

#[test]
fn a_heic_over_the_edge_cap_is_refused_before_decoding() {
    let tight = Limits {
        max_pixels: 40_000_000,
        max_edge: 63,
    };
    assert_eq!(
        decode(&fixture("checker-64.heic"), &tight, Depth::Pixels),
        Err(Refusal::TooLarge {
            width: 64,
            height: 64
        })
    );
}

#[test]
fn an_lzw_tiff_decodes_losslessly() {
    let (w, h, orientation, opaque, data) =
        rgba(decode(&fixture("quadrants-48-lzw.tif"), &LIMITS, Depth::Pixels).expect("decodes"));
    assert_eq!((w, h, orientation, opaque), (48, 48, 1, true));
    let at = |x: usize, y: usize| &data[(y * 48 + x) * 4..(y * 48 + x) * 4 + 3];
    assert_eq!(at(0, 0), [255, 0, 0]);
    assert_eq!(at(47, 0), [0, 255, 0]);
    assert_eq!(at(0, 47), [0, 0, 255]);
    assert_eq!(at(47, 47), [255, 255, 255]);
    assert_eq!(
        data,
        png_quadrant_rgba(),
        "every pixel as the source PNG has it"
    );
}

fn png_quadrant_rgba() -> Vec<u8> {
    png_rgb("quadrants-48.png")
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|p| [p[0], p[1], p[2], 255])
        .collect()
}

#[test]
fn a_tiff_probe_says_the_browser_may_draw_its_first_image() {
    assert_eq!(
        decode(&fixture("quadrants-48-lzw.tif"), &LIMITS, Depth::Probe),
        Ok(Found::Fits {
            width: 48,
            height: 48,
            native: true
        })
    );
}

#[test]
fn a_tiff_over_the_limits_is_refused_before_decoding() {
    let tight = Limits {
        max_pixels: 48 * 48 - 1,
        max_edge: 16_384,
    };
    assert_eq!(
        decode(&fixture("quadrants-48-lzw.tif"), &tight, Depth::Pixels),
        Err(Refusal::TooLarge {
            width: 48,
            height: 48
        })
    );
}

#[test]
fn a_file_of_another_format_is_refused_as_such() {
    assert!(matches!(
        decode(&fixture("quadrants-48.png"), &LIMITS, Depth::Pixels),
        Err(Refusal::Malformed(_))
    ));
}
