//! A window's console lines through the shipped bounds and the real workspace frames.

use super::*;
use citadel_internal_service_types::{BrowserConsoleEntry, BrowserConsoleSource};
use citadel_workspace_types::telemetry::TelemetryLevel;

fn console_error(message: &str, stack: Option<&str>) -> BrowserConsoleEntry {
    BrowserConsoleEntry {
        source: BrowserConsoleSource::ConsoleError,
        message: message.into(),
        stack: stack.map(Into::into),
        repeats: 2,
    }
}

#[test]
fn browser_lines_leave_the_agent_half_the_ring() {
    let windows_per_upload = UPLOAD_INTERVAL
        .as_millis()
        .div_ceil(BROWSER_WINDOW.as_millis());
    let longest_line = RING_MAX_MESSAGE_BYTES + "browser.rejection".len();
    let browser_bytes =
        windows_per_upload as usize * BROWSER_LINES_PER_WINDOW as usize * longest_line;
    assert!(
        browser_bytes <= RING_MAX_BYTES / 2,
        "{browser_bytes} of {RING_MAX_BYTES}"
    );
    assert!(BROWSER_LINES_PER_REQUEST <= BROWSER_LINES_PER_WINDOW as usize);
}

#[tokio::test]
async fn an_opted_in_window_s_console_line_is_uploaded_redacted() {
    let uplink = uplink();
    assert!(uplink.takes_browser_console());
    let line = console_error(
        "alice: GET https://ws.example.org/x?token=abc failed",
        Some("at send (/Users/alice/app.ts:1:2)"),
    );
    assert_eq!(
        uplink.browser_console(ALICE, std::slice::from_ref(&line)),
        0,
        "before consent"
    );
    uplink.on_server_frame(ALICE, &consent(true));
    assert_eq!(uplink.browser_console(ALICE, &[line]), 1);
    let link = Link::default();
    uplink.flush(&link).await;
    let sent = link.0.into_inner().unwrap();
    assert_eq!(sent.len(), 1);
    let batch = uploaded(&sent[0].1);
    let entry = &batch.entries[0];
    assert_eq!(
        (entry.target.as_str(), entry.level),
        ("browser.console", TelemetryLevel::Error)
    );
    assert!(entry.message.contains("(repeated 2 times)"));
    for secret in ["alice", "ws.example.org", "token=abc", "/Users/"] {
        assert!(
            !entry.message.contains(secret),
            "{secret} in {:?}",
            entry.message
        );
    }
}
