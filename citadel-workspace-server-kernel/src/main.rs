use citadel_logging::{info, setup_log};
use citadel_workspace_server_kernel::config::ServerConfig;
use std::fs;
use std::path::PathBuf;
use structopt::StructOpt;

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

    // Log startup information for observability
    info!(target: "citadel_workspace_server_kernel",
        version = env!("CARGO_PKG_VERSION"),
        "Citadel Workspace Server starting"
    );

    let options = Options::from_args();

    let config_content = fs::read_to_string(&options.config)
        .map_err(|e| format!("Failed to read config file {:?}: {}", options.config, e))?;

    let mut config: ServerConfig = toml::from_str(&config_content)
        .map_err(|e| format!("Failed to parse config file {:?}: {}", options.config, e))?;

    // Environment variable override for workspace master password (preferred over config file)
    if let Ok(env_password) = std::env::var("WORKSPACE_MASTER_PASSWORD") {
        if !env_password.is_empty() {
            config.workspace_master_password = env_password;
        }
    }

    // Validate master password is set and not a placeholder
    if config.workspace_master_password.is_empty() {
        return Err("workspace_master_password is required. Set via WORKSPACE_MASTER_PASSWORD env var or in kernel.toml".into());
    }

    info!(?config, "Loaded server configuration");

    // Get the directory containing the config file for resolving relative paths
    let config_base_path = options.config.parent();

    citadel_workspace_server_kernel::run_server_with_base_path(config, config_base_path).await?;

    Ok(())
}
