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

#[cfg(unix)]
mod sigterm {
    use citadel_workspace_server_kernel::await_termination_signal;
    use std::time::Duration;

    /// SIGTERM specifically: SIGINT is the terminal case and is handled
    /// alongside it, but `docker stop` sends SIGTERM and that is the path that
    /// was broken.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn sigterm_is_what_wakes_the_shutdown_wait() {
        let waiter = tokio::spawn(await_termination_signal());

        // The handler is installed inside that task; signalling before it is
        // ready would hit the default disposition and kill the test process.
        tokio::time::sleep(Duration::from_millis(300)).await;

        // SAFETY: raising a signal this process has just installed a handler for.
        unsafe {
            libc::raise(libc::SIGTERM);
        }

        let woke = tokio::time::timeout(Duration::from_secs(5), waiter).await;
        assert!(
            matches!(woke, Ok(Ok(true))),
            "SIGTERM did not wake the shutdown wait, so a container restart would \
             still kill the server without draining: {woke:?}"
        );
    }
}
