use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_sdk::prelude::{BackendType, NodeBuilder, NodeType, StackedRatchet};
use std::error::Error;
use std::net::SocketAddr;
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
    let service = CitadelWorkspaceService::new_websocket(opts.bind).await?;

    // Backend selection precedence:
    //   1. INTERNAL_SERVICE_BACKEND / INTERNAL_SERVICE_DATA_DIR env vars
    //   2. --backend / --data-dir CLI flags
    //   3. InMemory default
    //
    // Mirrors the workspace-server kernel's pattern (env -> config ->
    // default) so a container that has the env vars set in its
    // environment cannot silently end up on a different backend than
    // the operator intended just because the CMD wrapper got reshaped.
    // The Dockerfile still bridges env -> CLI today, but having the
    // env-var path inside the binary itself is the load-bearing
    // contract — the wrapper is just convenience.
    let backend_choice = std::env::var("INTERNAL_SERVICE_BACKEND")
        .ok()
        .or_else(|| opts.backend.clone());
    let data_dir_choice = std::env::var("INTERNAL_SERVICE_DATA_DIR")
        .ok()
        .or_else(|| opts.data_dir.clone());

    let backend_type = match backend_choice.as_deref() {
        Some("filesystem") => {
            let data_dir = data_dir_choice.unwrap_or_else(|| "./data".to_string());
            citadel_logging::info!(target: "citadel", "Using filesystem backend with data directory: {}", data_dir);
            BackendType::Filesystem(data_dir)
        }
        Some(other) => {
            return Err(format!(
                "Unknown backend type '{}'. Supported: 'filesystem' (or omit for in-memory)",
                other
            )
            .into());
        }
        None => {
            citadel_logging::info!(target: "citadel", "Using in-memory backend (data will not persist across restarts)");
            BackendType::InMemory
        }
    };

    // Initialize the node builder with StackedRatchet, which is a concrete implementation of the Ratchet trait
    let mut node_builder = NodeBuilder::<StackedRatchet>::default();
    let mut builder = node_builder
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
#[structopt(
    name = "internal-service",
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
    /// Data directory for filesystem backend (defaults to "./data")
    #[structopt(long)]
    data_dir: Option<String>,
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
