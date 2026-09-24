use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service::stun::{StunServers, STUN_SERVERS_ENV};
use citadel_internal_service::OriginPolicy;
use citadel_sdk::prelude::{BackendType, NodeBuilder, NodeType, StackedRatchet};
use std::error::Error;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use structopt::StructOpt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    citadel_logging::setup_log();

    // Initialize deadlock detector if feature is enabled
    #[cfg(feature = "deadlock-detection")]
    {
        let _ = *DEADLOCK_INIT;
    }

    let opts: Options = Options::from_args();

    // Which pages may open a control connection to this agent.
    //
    // A WebSocket is exempt from the same-origin policy and from CORS
    // preflight, so before this existed ANY page the user visited could open
    // ws://localhost:12345, enumerate every account with GetSessions and then
    // act as them. The allowlist is REQUIRED and startup fails without it: a
    // default would either be wrong for every real deployment (localhost) or be
    // the hole itself (any). See citadel_internal_service::OriginPolicy for
    // what this control does and does not reach.
    let origins = resolve_origin_policy(
        std::env::var("INTERNAL_SERVICE_ALLOWED_ORIGINS")
            .ok()
            .as_deref(),
        opts.allowed_origins.as_deref(),
    )?;
    // The STUN servers this agent learns its public address from, required like --bind: the
    // SDK would otherwise fall back to a built-in list nobody chose for this deployment.
    let stun_servers = StunServers::resolve(
        std::env::var(STUN_SERVERS_ENV).ok().as_deref(),
        opts.stun_servers.as_deref(),
    )?;

    if origins == OriginPolicy::Any {
        citadel_logging::warn!(
            target: "citadel",
            "⚠️  SECURITY WARNING: the WebSocket origin allowlist is `*`. Any page the \
             user visits can drive this agent. Never use in production!"
        );
    }

    // TLS by default. See BUILTIN_TLS_CERT for why the key ships in the binary,
    // and --no-tls for the one case where plain is right.
    let service = if opts.no_tls {
        citadel_logging::warn!(target: "citadel",
            "Serving plain ws:// (--no-tls). A page served over HTTPS cannot open this \
             socket; use this only behind a same-origin proxy on loopback.");
        CitadelWorkspaceService::new_websocket(opts.bind, origins).await?
    } else {
        CitadelWorkspaceService::new_websocket_tls(
            opts.bind,
            origins,
            BUILTIN_TLS_CERT,
            BUILTIN_TLS_KEY,
        )
        .await?
    };

    // Backend selection precedence:
    //   1. INTERNAL_SERVICE_BACKEND / INTERNAL_SERVICE_DATA_DIR env vars
    //   2. --backend / --data-dir CLI flags
    //   3. InMemory default
    //
    // KEEP IN SYNC WITH `citadel_workspace_server_kernel::select_backend_type`
    // (citadel-workspace-server-kernel/src/lib.rs:484). Both functions
    // share the same precedence shape (env > config-or-cli > default)
    // and the same empty-string-as-unset semantics. Drift between them
    // means a deployment can end up on a different backend than the
    // sibling service for the same configuration. The unit tests below
    // mirror the kernel's backend_select_tests so a divergence loudly
    // fails CI in both crates.
    let default_dir = default_data_dir(Path::new(LEGACY_DATA_DIR).is_dir(), dirs2::home_dir())?;
    let backend_type = select_backend_type(
        std::env::var("INTERNAL_SERVICE_BACKEND").ok().as_deref(),
        std::env::var("INTERNAL_SERVICE_DATA_DIR").ok().as_deref(),
        opts.backend.as_deref(),
        opts.data_dir.as_deref(),
        &default_dir,
    )?;

    // Initialize the node builder with StackedRatchet, which is a concrete implementation of the Ratchet trait
    let mut node_builder = NodeBuilder::<StackedRatchet>::default();
    let mut builder = stun_servers
        .apply(&mut node_builder)
        .with_backend(backend_type)
        .with_node_type(NodeType::Peer);

    if opts.dangerous.unwrap_or(false) {
        citadel_logging::warn!(target: "citadel", "⚠️  SECURITY WARNING: TLS certificate verification is DISABLED via --dangerous flag. Never use in production!");
        builder = builder.with_insecure_skip_cert_verification()
    }

    builder.build(service)?.await?;

    Ok(())
}

#[derive(Debug, StructOpt)]
// `--version` prints "citadel-agent <Cargo.toml version>", which the release gates compare
// with the tag (scripts/release-version.sh, scripts/lib/assert-agent-version.sh).
#[structopt(
    name = "citadel-agent",
    version = env!("CARGO_PKG_VERSION"),
    about = "Used for running a local service for citadel applications"
)]
struct Options {
    #[structopt(short, long)]
    bind: SocketAddr,
    #[structopt(short, long)]
    dangerous: Option<bool>,
    /// Backend type: "filesystem" for persistent storage, omit for in-memory
    #[structopt(long)]
    backend: Option<String>,
    /// Data directory for the filesystem backend. Defaults to `.citadel-agent` in
    /// the user's home directory (or `./data` where an existing one is found).
    #[structopt(long)]
    data_dir: Option<String>,
    /// Comma-separated list of browser origins allowed to open a control
    /// connection, e.g. "http://localhost:5291". Pass "*" to accept any origin
    /// (development only). Required; may also be given as
    /// INTERNAL_SERVICE_ALLOWED_ORIGINS, which takes precedence.
    #[structopt(long)]
    allowed_origins: Option<String>,
    /// Exactly three STUN servers, `host:port,host:port,host:port`, that this agent learns
    /// its public address from. Required; INTERNAL_SERVICE_STUN_SERVERS overrides it.
    #[structopt(long)]
    stun_servers: Option<String>,
    /// Serve plain `ws://` instead of `wss://`.
    ///
    /// Only correct when the page is itself on loopback and reaches the agent
    /// through a same-origin proxy. A page served over HTTPS cannot open a
    /// `ws://` socket at all, so this makes the agent unreachable from a hosted
    /// UI.
    #[structopt(long)]
    no_tls: bool,
}

/// The certificate the agent serves, and the only one.
///
/// There is no override. Every hosted page dials `wss://local.avarok.net:12345`, so
/// a different certificate could only ever break that handshake. Release builds
/// compile in a certificate issued at build time (release-agent.yml), so no
/// published agent carries one older than its release.
///
///
/// `local.avarok.net` is a public name whose A record is 127.0.0.1, so a
/// publicly-trusted certificate can be issued for it and every visitor's own
/// agent can present it. That is what makes a HOSTED page able to reach an
/// agent on the visitor's machine: the browser refuses `ws://` from an HTTPS
/// page, and refuses `wss://` without a certificate it trusts.
///
/// The private key is therefore inside a binary anyone can download, and that
/// is deliberate. What it authorises is a TLS handshake for a name that only
/// ever resolves to the loopback interface of the machine doing the
/// handshaking, so possession grants no access to anything of anyone else's.
/// The agent's own authorisation is the Origin allowlist, which is unchanged
/// and required.
const BUILTIN_TLS_CERT: &[u8] = include_bytes!("../tls/local.avarok.net.crt.pem");
const BUILTIN_TLS_KEY: &[u8] = include_bytes!("../tls/local.avarok.net.key.pem");

/// Resolve the origin allowlist from env + CLI, or explain what is missing.
///
/// Env wins over CLI, matching `select_backend_type` above, so a docker
/// operator can change it without rebuilding. Pure: no I/O, so the precedence
/// and the fail-fast are testable.
fn resolve_origin_policy(
    env_spec: Option<&str>,
    cli_spec: Option<&str>,
) -> Result<OriginPolicy, Box<dyn Error>> {
    // Empty strings are unset, for the same reason as the backend vars: an
    // unset `.env` entry arrives as Some("").
    let spec = env_spec
        .filter(|s| !s.is_empty())
        .or(cli_spec.filter(|s| !s.is_empty()));

    let Some(spec) = spec else {
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
fn select_backend_type(
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

/// Where an agent started before the per-user default kept its account.
const LEGACY_DATA_DIR: &str = "./data";

/// The data directory used when neither `--data-dir` nor the environment names one.
///
/// It was `./data`, relative to wherever the agent happened to be started, so
/// starting it from another folder silently began a new account -- and that
/// directory is the account: its keys, with no copy on any server. The default
/// is now one place per user. An existing `./data` is still used, never moved:
/// moving the only copy of someone's keys automatically is not a risk to take
/// for them, and a half-finished move across filesystems loses them.
fn default_data_dir(
    legacy_dir_exists: bool,
    home: Option<PathBuf>,
) -> Result<String, Box<dyn Error>> {
    if legacy_dir_exists {
        citadel_logging::warn!(target: "citadel",
            "Using the existing {LEGACY_DATA_DIR}, which is relative to the folder the agent was \
             started from. To keep your account wherever you start it, move that folder to \
             ~/.citadel-agent (with the agent stopped), or pass --data-dir.");
        return Ok(LEGACY_DATA_DIR.to_string());
    }
    let home = home.ok_or(
        "no home directory to keep the account in. Pass --data-dir, or set \
         INTERNAL_SERVICE_DATA_DIR, to the folder that should hold it.",
    )?;
    Ok(home.join(".citadel-agent").to_string_lossy().into_owned())
}

#[cfg(test)]
mod default_data_dir_tests {
    use super::*;

    #[test]
    fn a_fresh_install_keeps_its_account_in_the_home_directory() {
        let dir = default_data_dir(false, Some(PathBuf::from("/home/tester"))).unwrap();
        assert_eq!(
            PathBuf::from(dir),
            PathBuf::from("/home/tester").join(".citadel-agent")
        );
    }

    #[test]
    fn an_existing_data_folder_keeps_being_used_and_is_not_moved() {
        assert_eq!(
            default_data_dir(true, Some(PathBuf::from("/home/tester"))).unwrap(),
            "./data"
        );
    }

    #[test]
    fn no_home_directory_is_an_error_not_a_silent_cwd() {
        assert!(default_data_dir(false, None).is_err());
    }
}

#[cfg(test)]
mod backend_select_tests {
    //! Boundary tests for `select_backend_type`. Mirrors the kernel's
    //! `backend_select_tests` (see KEEP IN SYNC WITH note in `main()`)
    //! so any drift in precedence semantics between the two binaries
    //! fails CI on both sides instead of silently picking the wrong
    //! backend at deploy time.
    use super::*;
    use citadel_sdk::prelude::BackendType;

    // An explicit stand-in: the real default is computed from the host (home
    // directory, legacy ./data), which default_data_dir_tests cover.
    const DEFAULT: &str = "/home/tester/.citadel-agent";

    #[test]
    fn defaults_to_in_memory_when_nothing_is_set() {
        let bt = select_backend_type(None, None, None, None, DEFAULT).unwrap();
        assert!(matches!(bt, BackendType::InMemory));
    }

    #[test]
    fn cli_filesystem_uses_cli_data_dir() {
        let bt = select_backend_type(None, None, Some("filesystem"), Some("/srv/data"), DEFAULT)
            .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/srv/data"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn cli_filesystem_falls_back_to_default_data_dir() {
        let bt = select_backend_type(None, None, Some("filesystem"), None, DEFAULT).unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, DEFAULT),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn env_backend_overrides_cli_backend() {
        let bt = select_backend_type(
            Some("filesystem"),
            Some("/data/from-env"),
            None,
            None,
            DEFAULT,
        )
        .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/data/from-env"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn env_data_dir_overrides_cli_data_dir_independently() {
        let bt = select_backend_type(
            None,
            Some("/mnt/persistent"),
            Some("filesystem"),
            Some("/srv/data"),
            DEFAULT,
        )
        .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/mnt/persistent"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn unknown_backend_string_returns_error() {
        let err = select_backend_type(None, None, Some("redis"), None, DEFAULT).unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.contains("Unknown backend type 'redis'"),
            "error message should name the bad value: {msg}"
        );
    }

    #[test]
    fn empty_env_backend_falls_through_to_cli() {
        let bt = select_backend_type(
            Some(""),
            None,
            Some("filesystem"),
            Some("/srv/data"),
            DEFAULT,
        )
        .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/srv/data"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn empty_env_data_dir_falls_through_to_cli() {
        let bt = select_backend_type(
            Some("filesystem"),
            Some(""),
            None,
            Some("/srv/data"),
            DEFAULT,
        )
        .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/srv/data"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn explicit_in_memory_ignores_data_dir() {
        let bt =
            select_backend_type(None, Some("/should-be-ignored"), None, None, DEFAULT).unwrap();
        assert!(matches!(bt, BackendType::InMemory));
    }
}

#[cfg(feature = "deadlock-detection")]
lazy_static::lazy_static! {
    static ref DEADLOCK_INIT: () = {
        let _ = std::thread::spawn(move || {
            info!(target: "gadget", "Executing deadlock detector ...");
            use std::thread;
            use std::time::Duration;
            use parking_lot::deadlock;
            use citadel_logging::*;
            loop {
                std::thread::sleep(Duration::from_secs(5));
                let deadlocks = deadlock::check_deadlock();
                if deadlocks.is_empty() {
                    continue;
                }

                error!(target: "citadel", "{} deadlocks detected", deadlocks.len());
                for (i, threads) in deadlocks.iter().enumerate() {
                    error!(target: "citadel", "Deadlock #{}", i);
                    for t in threads {
                        error!(target: "citadel", "Thread Id {:#?}", t.thread_id());
                        error!(target: "citadel", "{:#?}", t.backtrace());
                    }
                }
            }
        });
    };
}

#[cfg(test)]
mod origin_policy_tests {
    //! The precedence and the fail-fast. `OriginPolicy::parse` is tested in the
    //! connector; what is tested here is that this binary REQUIRES a
    //! configuration rather than inventing one.
    use super::*;

    #[test]
    fn nothing_configured_is_a_startup_error() {
        // The whole point of the flag being required. A default would either be
        // wrong for every real deployment (localhost) or be the hole (any).
        let error = resolve_origin_policy(None, None).unwrap_err();
        let message = format!("{error}");
        assert!(
            message.contains("INTERNAL_SERVICE_ALLOWED_ORIGINS"),
            "the error must name the variable to set: {message}"
        );
    }

    #[test]
    fn empty_strings_count_as_unset() {
        // `.env` with a blank entry arrives as Some(""), exactly as for the
        // backend vars above.
        assert!(resolve_origin_policy(Some(""), Some("")).is_err());
    }

    #[test]
    fn the_cli_flag_is_used_when_the_env_var_is_unset() {
        let policy = resolve_origin_policy(None, Some("http://localhost:5291")).unwrap();
        assert!(policy.permits(Some("http://localhost:5291")));
        assert!(!policy.permits(Some("https://evil.example")));
    }

    #[test]
    fn the_env_var_wins_over_the_cli_flag() {
        // Same precedence as select_backend_type, so a docker operator can
        // change it without rebuilding.
        let policy =
            resolve_origin_policy(Some("http://from-env:1"), Some("http://from-cli:2")).unwrap();
        assert!(policy.permits(Some("http://from-env:1")));
        assert!(!policy.permits(Some("http://from-cli:2")));
    }

    #[test]
    fn an_empty_env_var_falls_through_to_the_cli_flag() {
        let policy = resolve_origin_policy(Some(""), Some("http://localhost:5291")).unwrap();
        assert!(policy.permits(Some("http://localhost:5291")));
    }

    #[test]
    fn a_malformed_specification_fails_startup_rather_than_degrading() {
        // A trailing slash never matches any browser Origin. Accepting it would
        // produce a listener that refuses the real UI and looks like downtime.
        let error = resolve_origin_policy(None, Some("http://localhost:5291/")).unwrap_err();
        assert!(format!("{error}").contains("invalid origin allowlist"));
    }

    #[test]
    fn the_wildcard_is_accepted_but_only_when_asked_for() {
        assert_eq!(
            resolve_origin_policy(None, Some("*")).unwrap(),
            OriginPolicy::Any
        );
    }
}
