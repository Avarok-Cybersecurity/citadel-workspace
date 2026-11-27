//! Hostile input: every truncation and a fixed sweep of corruptions of every fixture must end
//! in an answer, never a panic (a panic aborts the page's decoder), and a directory loop must end.

mod common;

use common::*;
use photo_decode::decode;
use photo_decode::outcome::{Depth, Refusal};

const FIXTURES: [&str; 3] = [
    "checker-64.heic",
    "quadrants-48-lzw.tif",
    "quadrants-48.jpg",
];

fn files() -> Vec<Vec<u8>> {
    let mut out: Vec<Vec<u8>> = FIXTURES[..2].iter().map(|n| fixture(n)).collect();
    let preview = fixture(FIXTURES[2]);
    let blobs: [&[u8]; 1] = [&preview];
    let at = blob_offsets(&blobs);
    out.push(build(
        false,
        &blobs,
        vec![jpeg_strip(7, 48, 48, at[0], preview.len() as u32)],
        vec![],
    ));
    out
}

#[test]
fn every_truncation_ends_in_an_answer() {
    for file in files() {
        for len in 0..file.len() {
            for depth in [Depth::Probe, Depth::Pixels] {
                let _ = decode(&file[..len], &LIMITS, depth);
            }
        }
    }
}

#[test]
fn corrupted_bytes_end_in_an_answer() {
    // A fixed linear congruential sweep: the same corruptions on every run.
    let mut state: u32 = 0x1234_5678;
    let mut next = || {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        state
    };
    for file in files() {
        for _ in 0..400 {
            let mut bad = file.clone();
            for _ in 0..(1 + next() % 4) {
                let at = next() as usize % bad.len();
                bad[at] = next() as u8;
            }
            let _ = decode(&bad, &LIMITS, Depth::Pixels);
        }
    }
}

#[test]
fn a_directory_that_links_to_itself_is_read_once() {
    let mut file = build(false, &[], vec![vec![(0x0100, vec![1])]], vec![]);
    let first = u32::from_le_bytes(file[4..8].try_into().unwrap()) as usize;
    let next = first + 2 + 12;
    file[next..next + 4].copy_from_slice(&(first as u32).to_le_bytes());
    assert!(matches!(
        decode(&file, &LIMITS, Depth::Pixels),
        Err(Refusal::Unsupported(_))
    ));
}

#[test]
fn a_tiff_declaring_a_huge_canvas_is_refused_without_allocating_it() {
    let pixels = vec![0u8; 3];
    let blobs: [&[u8]; 1] = [&pixels];
    let at = blob_offsets(&blobs);
    let file = build(
        false,
        &blobs,
        vec![rgb_strip(60_000, 60_000, at[0])],
        vec![],
    );
    assert_eq!(
        decode(&file, &LIMITS, Depth::Pixels),
        Err(Refusal::TooLarge {
            width: 60_000,
            height: 60_000
        })
    );
}
