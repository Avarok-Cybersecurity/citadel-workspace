//! A file transfer whose receiver stops answering is ended by the SDK, with a coded failure the
//! page words for the person, before the page's own idle timeout would give up on it.
//!
//! The SDK fails an unanswered group header within
//! `citadel_types::proto::timing::FILE_GROUP_HEADER_UNANSWERED_FAILS_WITHIN` (the deadline plus
//! one check period) as `ErrorCode::FileTransferStalled`. The page's RE-VFS push gives up after
//! `TIMEOUT.FILE_SEND_MS` without a tick (citadel-workspaces/src/lib/timeout-constants.ts) and
//! words code 666 itself (citadel-workspaces/src/lib/file-transfer/transfer-failure.ts). If the
//! page's timeout were the shorter, a person would read "Nothing answered for 30 s." for what the
//! SDK names exactly; if the page's code were not the SDK's, a stalled transfer would be shown in
//! the SDK's raw text. Both numbers are read from where they are defined, here and there.

use citadel_io::ErrorCode;
use citadel_types::proto::timing::FILE_GROUP_HEADER_UNANSWERED_FAILS_WITHIN;

const TIMEOUTS: &str = include_str!("../../citadel-workspaces/src/lib/timeout-constants.ts");
const FAILURE: &str =
    include_str!("../../citadel-workspaces/src/lib/file-transfer/transfer-failure.ts");

/// The integer `source` assigns after `marker`, up to the first `,` or `;`.
fn number_after(source: &str, marker: &str, file: &str) -> u64 {
    let (_, rest) = source
        .split_once(marker)
        .unwrap_or_else(|| panic!("{file} no longer contains `{marker}`"));
    let literal: String = rest
        .chars()
        .take_while(|c| *c != ',' && *c != ';')
        .filter(|c| !c.is_whitespace() && *c != '_')
        .collect();
    literal.parse().unwrap_or_else(|_| {
        panic!("{file}: `{marker}` is not followed by a number but `{literal}`")
    })
}

/// The value of `FILE_SEND_MS` in the object literal (not its type annotation, which names it too).
fn page_file_send_ms() -> u64 {
    let (_, body) = TIMEOUTS
        .split_once("} = {")
        .expect("timeout-constants.ts declares TIMEOUT as an annotated object literal");
    number_after(body, "FILE_SEND_MS:", "timeout-constants.ts")
}

/// Control: raise `FILE_GROUP_HEADER_ACK_DEADLINE` in the SDK past 29 s, or lower `FILE_SEND_MS`
/// to 16000 or less, and this fails.
#[test]
fn the_sdk_fails_an_unanswered_header_before_the_pages_idle_timeout() {
    let sdk_ms = FILE_GROUP_HEADER_UNANSWERED_FAILS_WITHIN.as_millis();
    let page_ms = u128::from(page_file_send_ms());
    assert!(
        sdk_ms < page_ms,
        "the SDK reports an unanswered file-transfer header within {sdk_ms} ms, but the page \
         gives up on a push after {page_ms} ms (TIMEOUT.FILE_SEND_MS): the person would be told \
         nothing answered instead of the SDK's coded failure"
    );
}

/// Control: change `FILE_TRANSFER_STALLED_CODE` in transfer-failure.ts, and this fails.
#[test]
fn the_page_words_the_sdks_stalled_transfer_code() {
    let page_code = number_after(
        FAILURE,
        "FILE_TRANSFER_STALLED_CODE: number =",
        "transfer-failure.ts",
    );
    assert_eq!(
        page_code,
        u64::from(ErrorCode::FileTransferStalled as u16),
        "transfer-failure.ts words code {page_code} as a stalled transfer, and the SDK's \
         FileTransferStalled is a different code"
    );
}
