use citadel_logging::{setup_log, error, info};
use std::path::PathBuf;
use std::fs;
use structopt::StructOpt;
use citadel_workspace_server_kernel::config::ServerConfig;

#[derive(Debug, StructOpt)]
#[structopt(
    name = "citadel-service-bin",
    about = "Used for running a local service for citadel applications"
)]
pub struct Options {
    #[structopt(short, long, parse(from_os_str))]
    config: PathBuf,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    setup_log();

    let options = Options::from_args();

    let config_content = fs::read_to_string(&options.config)
        .map_err(|e| format!("Failed to read config file {:?}: {}", options.config, e))?;

    let config: ServerConfig = toml::from_str(&config_content)
        .map_err(|e| format!("Failed to parse config file {:?}: {}", options.config, e))?;

    info!(?config, "Loaded server configuration");

    if let Err(e) = citadel_workspace_server_kernel::start_server(config).await {
        error!("Server failed to start or encountered an error: {e}");
        return Err(e.into()); // Propagate the error using Into
    }

    Ok(())
}
