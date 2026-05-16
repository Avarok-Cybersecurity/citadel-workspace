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

    // Validate master password is set AND not the `.env.example`
    // placeholder. The placeholder is deliberately unguessable but it
    // IS non-empty, so the previous `is_empty()` check let it through —
    // any operator who copied .env.example without editing would have
    // deployed with a known string. The marker `__CHANGE_ME__` is the
    // contract: anything containing it is the unedited template.
    let password = &config.workspace_master_password;
    if password.is_empty() {
        return Err("workspace_master_password is required. Set via WORKSPACE_MASTER_PASSWORD env var or in kernel.toml".into());
    }
    if password.contains("__CHANGE_ME__") {
        return Err(
            "workspace_master_password is still set to the .env.example placeholder. \
             Replace it with a real value, e.g. `openssl rand -hex 32`."
                .into(),
        );
    }

    info!(?config, "Loaded server configuration");

    // Get the directory containing the config file for resolving relative paths
    let config_base_path = options.config.parent();

    citadel_workspace_server_kernel::run_server_with_base_path(config, config_base_path).await?;

    Ok(())
}
