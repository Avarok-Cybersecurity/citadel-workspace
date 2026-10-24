//! What the tests that run the shipped binary share.
#![allow(dead_code)]

use std::path::Path;
use std::process::Command;

/// The STUN servers `.env.example` ships.
pub const STUN_SERVERS: &str =
    "stun.cloudflare.com:3478,stun1.l.google.com:19302,stun4.l.google.com:19302";

/// Exactly the arguments 0.10.6's launcher passed (packaging/linux/citadel-agent-launch.in at
/// agent-v0.10.6), in its order: what a tarball or hand-run agent relaunches with after a
/// self-update. It has no `--apps-private-network`, because 0.10.6 had no such setting.
pub fn launcher_0_10_6(bind: &str, data_dir: &Path) -> Vec<String> {
    let data_dir = data_dir.to_str().expect("a UTF-8 scratch path").to_string();
    [
        "--bind",
        bind,
        "--backend",
        "filesystem",
        "--data-dir",
        &data_dir,
        "--allowed-origins",
        "http://localhost:5291",
        "--stun-servers",
        STUN_SERVERS,
    ]
    .map(str::to_string)
    .to_vec()
}

/// The settings CI exports for its stack; a test that runs the binary decides them itself.
const AGENT_ENV: [&str; 3] = [
    "INTERNAL_SERVICE_APPS_PRIVATE_NETWORK",
    "INTERNAL_SERVICE_ALLOWED_ORIGINS",
    "INTERNAL_SERVICE_STUN_SERVERS",
];

/// `command` without any of `AGENT_ENV`.
pub fn without_agent_env(command: &mut Command) -> &mut Command {
    AGENT_ENV.iter().fold(command, |c, name| c.env_remove(name))
}
