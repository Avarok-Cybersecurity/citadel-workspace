use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_sdk::prelude::{BackendType, NodeBuilder, NodeType};
use std::error::Error;
use std::net::SocketAddr;
use structopt::StructOpt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    citadel_logging::setup_log();
    let opts: Options = Options::from_args();
    let service = CitadelWorkspaceService::new_tcp(opts.bind).await?;

    let mut builder = NodeBuilder::default();
    let mut builder = builder
        .with_backend(BackendType::InMemory) // TODO: parameterize this in the opts
        .with_node_type(NodeType::Peer);

    if opts.dangerous.unwrap_or(false) {
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
