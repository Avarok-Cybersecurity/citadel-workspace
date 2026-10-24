//! Members re-accept the platform terms only when `PLATFORM_TERMS_VERSION` changes, so a change
//! to the text that is not matched by a bump would bind members to terms they never saw. Each
//! version's text is pinned here by hash: editing the text fails this test until the version
//! is bumped and the new text pinned beside it. Never re-pin an existing version.

use citadel_workspace_types::terms::{PLATFORM_TERMS_TEXT, PLATFORM_TERMS_VERSION};

/// (version, FNV-1a 64 of that version's `platform_terms.md`), oldest first.
const PINNED: &[(u32, u64)] = &[
    (1, 0x79c3_ab2f_f6e9_a7c7),
    (2, 0xc53f_c3f4_4696_3216),
    (3, 0x2848_d1c1_6063_f8ff),
];

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

#[test]
fn the_current_text_is_the_one_pinned_for_the_current_version() {
    let (version, hash) = *PINNED.last().expect("at least one pinned version");
    assert_eq!(
        version, PLATFORM_TERMS_VERSION,
        "pin the new version's text here"
    );
    assert_eq!(
        fnv1a(PLATFORM_TERMS_TEXT.as_bytes()),
        hash,
        "platform_terms.md changed without a PLATFORM_TERMS_VERSION bump"
    );
}

#[test]
fn versions_only_ever_go_up() {
    assert!(PINNED.windows(2).all(|pair| pair[0].0 < pair[1].0));
}

#[test]
fn the_text_names_its_own_version() {
    let heading = format!("**Version {PLATFORM_TERMS_VERSION} ·");
    assert!(
        PLATFORM_TERMS_TEXT.contains(&heading),
        "platform_terms.md does not say {heading}"
    );
}

#[test]
fn the_text_says_browser_console_output_is_collected() {
    assert!(PLATFORM_TERMS_TEXT.contains("browser's console"));
}
