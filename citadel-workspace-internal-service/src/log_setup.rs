//! The shipped agent's logging.
//!
//! `citadel_logging::setup_log()` reads only `RUST_LOG`, falls back to errors, and prints no
//! timestamps. The installed app sets no `RUST_LOG`, so a session the agent lost to a failed
//! reconnect left no reason in the user's log, and nothing said when (found live 2026-09-29).

use tracing_appender::non_blocking::{NonBlocking, NonBlockingBuilder, WorkerGuard};
use tracing_subscriber::EnvFilter;

/// Log lines held for the writer thread before new ones are dropped.
///
/// Lines are written on a thread of their own. Written on the runtime, a log sink that drains
/// slowly stalled every task: the fable lane measured 48/48 messaging runs failing with trace
/// logging behind a 20 KB/s reader, 0/48 with the same logging to a fast sink (2026-09-29). A
/// stalled agent loses its sessions; a dropped log line loses a log line. Explicit, because the
/// crate's default is an unstated 128,000.
pub const LOG_QUEUE_LINES: usize = 16_384;

/// A writer that never blocks its caller: lines queue for a background thread, and past
/// `queue_lines` the newest are dropped. Keep the guard for the life of the process; dropping it
/// flushes and stops the thread.
pub fn non_blocking_writer<W>(sink: W, queue_lines: usize) -> (NonBlocking, WorkerGuard)
where
    W: std::io::Write + Send + 'static,
{
    NonBlockingBuilder::default()
        .lossy(true)
        .buffered_lines_limit(queue_lines)
        .finish(sink)
}

/// What the shipped agent logs when `RUST_LOG` is unset: errors, plus the reconnect path at info
/// (`citadel_internal_service::RECONNECT_LOG_TARGET`). One place for every platform: the Windows
/// start-at-login entry cannot set environment variables. Owner-approved default, 2026-09-29.
pub const SHIPPED_LOG_FILTER: &str = "error,citadel::reconnect=info";

/// The filter directives to use: `RUST_LOG` when it is set, the shipped filter otherwise.
/// A `RUST_LOG` that does not parse is an error, not a silent fallback.
pub fn filter_directives(rust_log: Option<&str>) -> Result<String, String> {
    let directives: &str = match rust_log {
        Some(value) if !value.trim().is_empty() => value,
        _ => SHIPPED_LOG_FILTER,
    };
    EnvFilter::try_new(directives)
        .map(|_| directives.to_owned())
        .map_err(|err| format!("RUST_LOG={directives:?} is not a valid log filter: {err}"))
}

/// Installs the panic hook `setup_log()` installs, then a timestamped subscriber writing through
/// `non_blocking_writer`. The returned guard must be held until the process ends.
pub fn install() -> Result<WorkerGuard, String> {
    std::panic::set_hook(Box::new(|info| {
        // Straight to stderr as well: `exit` below skips destructors, so a line only queued for
        // the writer thread would be lost with the one message that explains the exit.
        eprintln!("Panic occurred: {info}");
        citadel_logging::error!(target: "citadel", "Panic occurred: {info}");
        // No console to read the line above, and the process is about to end: say so in a dialog.
        #[cfg(windows)]
        crate::windows_shell::report_fatal(&std::io::Error::other(format!(
            "Panic occurred: {info}"
        )));
        std::process::exit(1);
    }));
    let rust_log: Option<String> = std::env::var("RUST_LOG").ok();
    let directives: String = filter_directives(rust_log.as_deref())?;
    let (writer, guard) = non_blocking_writer(std::io::stdout(), LOG_QUEUE_LINES);
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new(directives))
        .with_target(true)
        .with_writer(writer)
        .try_init()
        .map_err(|err| format!("could not install the log subscriber: {err}"))?;
    Ok(guard)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unset_or_blank_rust_log_uses_the_shipped_filter() {
        assert_eq!(filter_directives(None).as_deref(), Ok(SHIPPED_LOG_FILTER));
        assert_eq!(
            filter_directives(Some("  ")).as_deref(),
            Ok(SHIPPED_LOG_FILTER)
        );
    }

    #[test]
    fn a_set_rust_log_wins() {
        assert_eq!(
            filter_directives(Some("citadel=debug")).as_deref(),
            Ok("citadel=debug")
        );
    }

    #[test]
    fn an_invalid_rust_log_is_an_error_not_a_fallback() {
        assert!(filter_directives(Some("citadel=nonsense-level")).is_err());
    }

    #[test]
    fn the_shipped_filter_parses() {
        assert!(EnvFilter::try_new(SHIPPED_LOG_FILTER).is_ok());
    }

    /// A sink whose first write blocks until released: a log reader that stopped draining.
    struct StuckSink {
        entered: std::sync::mpsc::Sender<()>,
        release: Option<std::sync::mpsc::Receiver<()>>,
    }

    impl std::io::Write for StuckSink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if let Some(release) = self.release.take() {
                let _ = self.entered.send(());
                let _ = release.recv();
            }
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_log_sink_that_stops_draining_does_not_stop_the_logger() {
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let sink = StuckSink {
            entered: entered_tx,
            release: Some(release_rx),
        };
        let (writer, guard) = non_blocking_writer(sink, 4);
        let subscriber = tracing_subscriber::fmt().with_writer(writer).finish();
        let (returned_tx, returned_rx) = std::sync::mpsc::channel();
        let logger = std::thread::spawn(move || {
            tracing::subscriber::with_default(subscriber, || {
                // More lines than the queue holds, while the sink is stuck on the first.
                for i in 0..64 {
                    tracing::error!("line {i}");
                }
            });
            let _ = returned_tx.send(());
        });
        entered_rx
            .recv()
            .expect("the writer thread reached the sink");
        // Hang guard, not a latency bound: a logger that writes on the caller's thread never
        // returns while the sink is stuck, so this fails instead of hanging the suite.
        assert!(
            returned_rx
                .recv_timeout(std::time::Duration::from_secs(20))
                .is_ok(),
            "logging blocked on a sink that stopped draining"
        );
        release_tx.send(()).expect("release the sink");
        logger.join().expect("logger thread");
        drop(guard);
    }
}
