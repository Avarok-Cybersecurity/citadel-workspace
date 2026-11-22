//! The agent's start: every setting resolved, then the service built and run (main.rs calls it).

#[cfg(windows)]
use crate::startup_config::origin_spec;
use crate::startup_config::{default_data_dir, resolve_origin_policy, select_backend_type};
#[cfg(feature = "self-update")]
use crate::update_setup;
#[cfg(windows)]
use crate::windows_shell;
#[cfg(feature = "deadlock-detection")]
use crate::DEADLOCK_INIT;
use crate::{
    app_net, apps_authority, fresh_start, identity_setup, log_setup, notice_token, p2p_kex_setup,
    parse_options, server_certificate, telemetry, Options, BUILTIN_TLS_CERT, BUILTIN_TLS_KEY,
};
use citadel_internal_service::kernel::{revfs_seed, CitadelWorkspaceService};
use citadel_internal_service::stun::{StunServers, STUN_SERVERS_ENV};
use citadel_internal_service::{sweep_stale_browser_transfers, BrowserTransferRoot};
use citadel_internal_service::{OriginPolicy, AGENT_SUPERVISOR, SERVER_RECONNECT};
use citadel_sdk::prelude::{
    BackendType, LinkManagerMode, MaxSecurityLevel, NodeBuilder, NodeType, SecurityLevel,
    StackedRatchet,
};
use std::error::Error;

pub(crate) async fn run() -> Result<(), Box<dyn Error>> {
    let (telemetry_collector, telemetry_uplink) =
        telemetry::build(env!("CARGO_PKG_VERSION"), std::env::consts::OS)?;
    // Held for the whole run: dropping it stops the log writer thread.
    let _log_writer = log_setup::install(telemetry_collector)?;

    // Started by an updating agent to start its successor and roll it back if it fails
    // (citadel-internal-service's updater/watchdog.rs): nothing else of this run applies.
    #[cfg(feature = "self-update")]
    if let Some(code) = citadel_internal_service::updater::watchdog::run_if_requested() {
        std::process::exit(code);
    }

    // Staged browser uploads older than their TTL, from a run that ended before its own cleanup
    // (a restart, a crash, sleep). Without this they were never removed: the other agent binary
    // (citadel-internal-service/service) swept at startup and this one, the one that ships, did
    // not, so they piled up until the 256 MiB staging cap refused every browser send (found live
    // 2026-09-27: 254 MB of staged files from Sept 23 on; a 2 MB send refused). First, before
    // argument parsing, so every start sweeps; blocking std::fs, before any task is spawned.
    let browser_transfers = BrowserTransferRoot::in_system_temp_dir();
    sweep_stale_browser_transfers(&browser_transfers);

    // Initialize deadlock detector if feature is enabled
    #[cfg(feature = "deadlock-detection")]
    {
        let _ = *DEADLOCK_INIT;
    }

    let opts: Options = parse_options();

    // Which pages may open a control connection to this agent.
    //
    // A WebSocket is exempt from the same-origin policy and from CORS
    // preflight, so before this existed ANY page the user visited could open
    // ws://localhost:12345, enumerate every account with GetSessions and then
    // act as them. The allowlist is REQUIRED and startup fails without it: a
    // default would either be wrong for every real deployment (localhost) or be
    // the hole itself (any). See citadel_internal_service::OriginPolicy for
    // what this control does and does not reach.
    let env_origins = std::env::var("INTERNAL_SERVICE_ALLOWED_ORIGINS").ok();
    let origins = resolve_origin_policy(env_origins.as_deref(), opts.allowed_origins.as_deref())?;
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

    // Host egress for Citadel apps refuses every page origin this agent serves (app_net.rs).
    // Whether it reaches a member's private network is that member's own grant, made on the
    // agent page (citadel-internal-service's kernel/apps/settings.rs), not a flag.
    let app_net = app_net::app_net_config(&origins, opts.bind.port());

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
    let default_dir = default_data_dir(dirs2::home_dir())?;
    let backend_type = select_backend_type(
        std::env::var("INTERNAL_SERVICE_BACKEND").ok().as_deref(),
        std::env::var("INTERNAL_SERVICE_DATA_DIR").ok().as_deref(),
        opts.backend.as_deref(),
        opts.data_dir.as_deref(),
        &default_dir,
    )?;

    // How long the portable identity stays unlocked, required like the STUN servers; its store
    // follows the backend just chosen (identity_setup.rs).
    let unlock_idle = identity_setup::unlock_idle(
        std::env::var(identity_setup::UNLOCK_IDLE_ENV)
            .ok()
            .as_deref(),
        opts.identity_unlock_idle_secs.as_deref(),
    )?;
    let identity = identity_setup::identity_config(unlock_idle, &backend_type)?;

    let skips_verification = server_certificate::skips_verification(
        opts.dangerous.unwrap_or(false),
        server_certificate::SERVER_CERTIFICATE,
    )?;

    // Every required setting has resolved, and nothing is bound yet: an updating agent asks
    // a staged version this before installing it (citadel-internal-service's
    // updater/launch_check.rs), so one that would refuse its command is never swapped in.
    if opts.check_launch {
        return Ok(());
    }

    // After the launch check, so an update still installs; the new agent then refuses an
    // earlier agent's data by name, saying where it is (citadel_internal_service::data_format).
    // An earlier agent's directory is offered for a fresh start rather than only refused.
    if let BackendType::Filesystem(dir) = &backend_type {
        let consent = fresh_start::LauncherConsent {
            dir: opts.start_fresh_from.clone(),
        };
        let status = fresh_start::StatusFile::from_env_value(
            std::env::var(fresh_start::STATUS_FILE_ENV).ok().as_deref(),
        );
        #[cfg(windows)]
        let shell = windows_shell::start_fresh_prompt();
        #[cfg(windows)]
        let native: &dyn fresh_start::Prompt = match &shell {
            Some(shell) => shell,
            None => &fresh_start::Nobody,
        };
        #[cfg(all(unix, not(target_os = "macos")))]
        let native: &dyn fresh_start::Prompt = &fresh_start::Zenity;
        #[cfg(target_os = "macos")]
        let native: &dyn fresh_start::Prompt = &fresh_start::Nobody;
        let prompt = fresh_start::FirstAnswer(vec![&consent, native]);
        fresh_start::ensure_readable(
            std::path::Path::new(dir),
            &fresh_start::Ports {
                prompt: &prompt,
                disposer: &fresh_start::SystemDisposer,
                status: status.as_ref(),
                home: dirs2::home_dir(),
            },
        )?;
    }

    // TLS by default. See BUILTIN_TLS_CERT for why the key ships in the binary,
    // and --no-tls for the one case where plain is right.
    let service = if opts.no_tls {
        citadel_logging::warn!(target: "citadel",
            "Serving plain ws:// (--no-tls). A page served over HTTPS cannot open this \
             socket; use this only behind a same-origin proxy on loopback.");
        CitadelWorkspaceService::new_websocket(
            opts.bind,
            origins,
            SERVER_RECONNECT,
            browser_transfers,
            server_certificate::SERVER_CERTIFICATE,
        )
        .await?
    } else {
        CitadelWorkspaceService::new_websocket_tls(
            opts.bind,
            origins,
            BUILTIN_TLS_CERT,
            BUILTIN_TLS_KEY,
            SERVER_RECONNECT,
            browser_transfers,
            server_certificate::SERVER_CERTIFICATE,
        )
        .await?
    }
    .with_supervisor(AGENT_SUPERVISOR)
    .with_telemetry(telemetry_uplink)
    .with_app_net(
        app_net,
        std::sync::Arc::new(apps_authority::WorkspaceHostNetAuthority),
    )
    .with_app_sessions(app_net::app_session_config());
    // Each account's RE-VFS key, from a seed sealed under a vault that follows the backend.
    let revfs_keys = service.revfs_key_source(revfs_seed::vault_for(&backend_type)?)?;
    // Each identity session signs its P2P key exchanges, and peers' keys are pinned.
    let kex_identity = p2p_kex_setup::kex_identity(&service, &backend_type).await?;

    // Initialize the node builder with StackedRatchet, which is a concrete implementation of the Ratchet trait
    let mut node_builder = NodeBuilder::<StackedRatchet>::default();
    let mut builder = stun_servers
        .apply(&mut node_builder)
        .with_backend(backend_type)
        .with_node_type(NodeType::Peer)
        // The owner's production maximum for the agent (2026-11-18); the SDK has no default.
        .with_max_security_level(MaxSecurityLevel::new(SecurityLevel::Custom(10))?)
        // Managed links are not switched on in this release.
        .with_link_manager(LinkManagerMode::Legacy)
        .with_revfs_key_source(revfs_keys)
        .with_p2p_kex_identity(kex_identity);

    if skips_verification {
        citadel_logging::warn!(target: "citadel", "⚠️  SECURITY WARNING: TLS certificate verification is DISABLED via --dangerous flag. Never use in production!");
        builder = builder.with_insecure_skip_cert_verification()
    }

    // Bound successfully, so this is the agent that stays up: only now does it get an icon, and a
    // second copy that found the port taken never flashes one.
    #[cfg(windows)]
    if let Some(spec) = origin_spec(env_origins.as_deref(), opts.allowed_origins.as_deref()) {
        windows_shell::start_tray(spec);
    }

    let service = identity_setup::applied(service, identity);
    let service = notice_token::applied(service);
    #[cfg(feature = "self-update")]
    let service = update_setup::applied(service, opts.bind)?;
    builder.build(service)?.await?;

    Ok(())
}
