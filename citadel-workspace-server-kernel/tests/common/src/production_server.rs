//! The server people deploy, started in-process on a free loopback port.
//!
//! Built through `run_server_with_base_path` rather than a test node, so a
//! test against it proves something about the shipped wiring.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::sign_in::native::init_sign_in_seed;
use citadel_workspace_server_kernel::kernel::sign_in::turnstile::SiteVerify;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// `kernel.toml`'s required `stun_servers`, as the SDK's loopback test list: the tests build the
/// SDK with `localhost-testing`, under which no STUN server is ever contacted.
pub fn test_stun_servers_toml() -> String {
    let quoted: Vec<String> = citadel_sdk::test_common::LOCALHOST_STUN_SERVERS
        .iter()
        .map(|s| format!("{s:?}"))
        .collect();
    format!("stun_servers = [{}]", quoted.join(", "))
}

/// `kernel.toml`'s required `[path_policy]`: every path for every class, in the shipped order.
/// A table, so it goes after every top-level key.
pub fn test_path_policy_toml() -> String {
    let rules: Vec<String> = ["Direct", "PeerRelay", "Turn", "ServerRelay"]
        .iter()
        .enumerate()
        .map(|(weight, kind)| {
            format!(
                "[[path_policy.rules]]\nkind = \"{kind}\"\nenabled = true\n\
                 attempt_timeout_seconds = 30\ncost_weight = {weight}\n\
                 classes = [\"Control\", \"Msg\", \"File\", \"Media\"]\n"
            )
        })
        .collect();
    format!("[path_policy]\ndenied = []\n{}", rules.join("\n"))
}

fn free_addr() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    listener.local_addr().expect("addr")
}

/// A directory of its own for one server's sign-in files, holding a seed made the way an
/// operator makes one (`--init-sign-in-seed`). Kept for the life of the test process: the
/// server reads from it for as long as it runs.
pub fn sign_in_dir() -> PathBuf {
    let dir = tempfile::Builder::new()
        .prefix("citadel-sign-in-")
        .tempdir()
        .expect("temp dir")
        .keep();
    init_sign_in_seed(&dir.join("oprf-seed")).expect("seed");
    dir
}

/// `[sign_in]` for a server with post-quantum sign-in and no human check, its seed in `dir`.
pub fn sign_in_without_admission(dir: &Path) -> String {
    format!(
        "[sign_in]\noprf_seed_file = \"{}\"\nksf = \"owasp-floor\"\nadmission = \"none\"\n",
        dir.join("oprf-seed").display()
    )
}

/// Starts the production server and returns once it accepts TCP connections.
pub async fn start_production_server() -> SocketAddr {
    start_production_server_with("").await
}

/// As `start_production_server`, with `extra_toml` appended to the kernel
/// config -- for a test whose property depends on a setting the deployed
/// server takes from `kernel.toml`. Sign-in is post-quantum, with no human check.
pub async fn start_production_server_with(extra_toml: &str) -> SocketAddr {
    let sign_in = sign_in_without_admission(&sign_in_dir());
    start_native_server(&format!("{extra_toml}\n{sign_in}"), None).await
}

/// The production server with `tail` (its `[sign_in]` included) appended to the kernel config,
/// asking `site_verify` for Turnstile verdicts when given, else Cloudflare.
pub async fn start_native_server(
    tail: &str,
    site_verify: Option<Arc<dyn SiteVerify>>,
) -> SocketAddr {
    assert!(
        std::env::var("WORKSPACE_BIND_ADDR").is_err(),
        "WORKSPACE_BIND_ADDR is set; the server would bind it instead of the test's port"
    );
    let addr = free_addr();
    // The shipped `[documents]` limits, after `extra_toml`: a table takes every key after it.
    let config: ServerConfig = toml::from_str(&format!(
        "bind_addr = \"{addr}\"\nworkspace_master_password = \"a-test-master-password\"\nrequire_platform_terms = false\nsecure_links_per_member = 5\nsecure_links_pool = 0\n{}\n{tail}\n{}\n{}",
        test_stun_servers_toml(),
        crate::documents_test_utils::shipped_documents_section(),
        test_path_policy_toml()
    ))
    .expect("config");
    tokio::spawn(async move {
        let result = match site_verify {
            Some(site_verify) => {
                citadel_workspace_server_kernel::run_server_with_site_verify(
                    config,
                    None,
                    site_verify,
                )
                .await
            }
            None => citadel_workspace_server_kernel::run_server_with_base_path(config, None).await,
        };
        panic!("the production server ended: {result:?}");
    });
    for _ in 0..200 {
        if TcpStream::connect(addr).is_ok() {
            return addr;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("the production server never listened on {addr}");
}
