//! The shipped agent's logging.
//!
//! `citadel_logging::setup_log()` reads only `RUST_LOG`, falls back to errors, and prints no
//! timestamps. The installed app sets no `RUST_LOG`, so a session the agent lost to a failed
//! reconnect left no reason in the user's log, and nothing said when (found live 2026-09-29).

use tracing_subscriber::EnvFilter;

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

/// Installs the panic hook `setup_log()` installs, then a timestamped subscriber.
pub fn install() -> Result<(), String> {
    std::panic::set_hook(Box::new(|info| {
        citadel_logging::error!(target: "citadel", "Panic occurred: {info}");
        std::process::exit(1);
    }));
    let rust_log: Option<String> = std::env::var("RUST_LOG").ok();
    let directives: String = filter_directives(rust_log.as_deref())?;
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new(directives))
        .with_target(true)
        .try_init()
        .map_err(|err| format!("could not install the log subscriber: {err}"))
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
}
