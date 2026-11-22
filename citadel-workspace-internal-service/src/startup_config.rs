//! The settings the agent starts with, each resolved from the environment and the command line:
//! pure, so the precedence and the refusals are tested (startup_config_tests.rs).

use citadel_internal_service::OriginPolicy;
use citadel_sdk::prelude::BackendType;
use std::error::Error;
use std::path::PathBuf;

/// The allowlist specification in force: env over CLI. Empty strings are unset, for the same
/// reason as the backend vars: an unset `.env` entry arrives as Some("").
pub(crate) fn origin_spec<'a>(
    env_spec: Option<&'a str>,
    cli_spec: Option<&'a str>,
) -> Option<&'a str> {
    env_spec
        .filter(|s| !s.is_empty())
        .or(cli_spec.filter(|s| !s.is_empty()))
}

/// Resolve the origin allowlist from env + CLI, or explain what is missing.
///
/// Env wins over CLI, matching `select_backend_type` above, so a docker
/// operator can change it without rebuilding. Pure: no I/O, so the precedence
/// and the fail-fast are testable.
pub(crate) fn resolve_origin_policy(
    env_spec: Option<&str>,
    cli_spec: Option<&str>,
) -> Result<OriginPolicy, Box<dyn Error>> {
    let Some(spec) = origin_spec(env_spec, cli_spec) else {
        return Err("no WebSocket origin allowlist configured. Set \
             INTERNAL_SERVICE_ALLOWED_ORIGINS (or pass --allowed-origins) to the origins \
             your UI is served from, e.g. \"http://localhost:5291\". Pass \"*\" to accept \
             any origin — development only, and it lets any page the user visits drive \
             this agent."
            .into());
    };

    OriginPolicy::parse(spec).map_err(|why| format!("invalid origin allowlist: {why}").into())
}

/// Resolve the backend type from env-var override (preferred), CLI flag
/// fallback, and the InMemory default. Mirrors the precedence shape of
/// `citadel_workspace_server_kernel::select_backend_type`
/// (env > config-or-cli > default) — see KEEP IN SYNC WITH comment in
/// `main()` above. Pure: side effects are limited to structured logging.
pub(crate) fn select_backend_type(
    env_backend: Option<&str>,
    env_data_dir: Option<&str>,
    cli_backend: Option<&str>,
    cli_data_dir: Option<&str>,
    default_data_dir: &str,
) -> Result<BackendType, Box<dyn Error>> {
    // Treat empty strings as unset. `std::env::var().ok()` returns
    // `Some("")` for `INTERNAL_SERVICE_DATA_DIR=""` from `.env`, which
    // would short-circuit the `.or()` and silently produce
    // `BackendType::Filesystem("")` — writing data to the container CWD
    // instead of the configured volume mount.
    let env_backend = env_backend.filter(|s| !s.is_empty());
    let env_data_dir = env_data_dir.filter(|s| !s.is_empty());
    let cli_backend = cli_backend.filter(|s| !s.is_empty());
    let cli_data_dir = cli_data_dir.filter(|s| !s.is_empty());
    let backend_choice = env_backend.or(cli_backend);
    let data_dir_choice = env_data_dir.or(cli_data_dir);

    match backend_choice {
        Some("filesystem") => {
            let data_dir = data_dir_choice.unwrap_or(default_data_dir).to_string();
            citadel_logging::info!(target: "citadel", "Using filesystem backend with data directory: {}", data_dir);
            Ok(BackendType::Filesystem(data_dir))
        }
        Some(other) => Err(format!(
            "Unknown backend type '{}'. Supported: 'filesystem' (or omit for in-memory)",
            other
        )
        .into()),
        None => {
            citadel_logging::info!(target: "citadel", "Using in-memory backend (data will not persist across restarts)");
            Ok(BackendType::InMemory)
        }
    }
}

/// The data directory used when neither `--data-dir` nor the environment names one: one place
/// per user, whichever folder the agent is started from (that directory is the account: its
/// keys, with no copy on any server).
pub(crate) fn default_data_dir(home: Option<PathBuf>) -> Result<String, Box<dyn Error>> {
    let home = home.ok_or(
        "no home directory to keep the account in. Pass --data-dir, or set \
         INTERNAL_SERVICE_DATA_DIR, to the folder that should hold it.",
    )?;
    Ok(home.join(".citadel-agent").to_string_lossy().into_owned())
}

#[cfg(test)]
#[path = "startup_config_tests.rs"]
mod tests;
