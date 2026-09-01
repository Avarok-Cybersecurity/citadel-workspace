//! A planned restart has to reach the clients, not just the process.
//!
//! `on_stop` broadcasts `ServerShutdown` and holds a drain window, and the UI
//! has a handler for it. Nothing was firing it: the kernel executor reaches
//! `on_stop` only when its own select completes, and SIGTERM had no handler in
//! the binary, in the SDK, or as a `stop_grace_period` in compose — so
//! `docker compose restart` terminated the process outright. The broadcast
//! never went out and the drain never happened; a planned restart was
//! indistinguishable from the server falling over.
//!
//! These tests are about the WIRING, which is what was missing. The drain and
//! the broadcast were already correct.
//!
//! The two halves live in separate files because `raise` is PROCESS-wide and
//! the harness runs a binary's tests concurrently: the test that raises
//! SIGTERM woke the one asserting that no signal arrives, and failed it. Rust
//! gives each integration test file its own binary, which is the separation
//! this needs.

use citadel_workspace_server_kernel::await_termination_signal;
use std::time::Duration;

/// The wait must not resolve on its own: a future that returned immediately
/// would have the server request a shutdown the moment it booted.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_signal_wait_does_not_resolve_on_its_own() {
    let waited = tokio::time::timeout(Duration::from_millis(500), await_termination_signal()).await;

    assert!(
        waited.is_err(),
        "await_termination_signal resolved with no signal sent: the server would \
         ask for a shutdown as soon as it booted"
    );
}
