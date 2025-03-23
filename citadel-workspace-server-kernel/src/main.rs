use citadel_logging::info;
use citadel_sdk::prelude::{
    BackendType, NodeBuilder, NodeType, StackedRatchet,
};
use std::error::Error;
use std::net::SocketAddr;
use structopt::StructOpt;

// Import the refactored modules
mod commands;
mod handlers;
mod kernel;
mod structs;

use kernel::WorkspaceServerKernel;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    citadel_logging::setup_log();
    let opts: Options = Options::from_args();
    let service = WorkspaceServerKernel::<StackedRatchet>::default();
    let mut builder = NodeBuilder::default();
    let mut builder = builder
        .with_backend(BackendType::new("sqlite:./citadel.db")?)
        .with_node_type(NodeType::server(opts.bind)?);

    if opts.dangerous.unwrap_or(false) {
        builder = builder.with_insecure_skip_cert_verification()
    }

    builder.build(service)?.await?;

    Ok(())
}

#[derive(Debug, StructOpt)]
#[structopt(
    name = "citadel-service-bin",
    about = "Used for running a local service for citadel applications"
)]
pub struct Options {
    #[structopt(short, long)]
    bind: SocketAddr,
    #[structopt(short, long)]
    dangerous: Option<bool>,
}