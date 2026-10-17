//! The `[sign_in]` the image ships is one the server accepts, its seed is the one the image's
//! start script makes, and its Argon2id cost is the hosted tenants' own.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::sign_in::config::plan;
use citadel_workspace_server_kernel::kernel::sign_in::KsfParams;
use std::path::{Path, PathBuf};

fn repo(path: &str) -> String {
    let full = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(path);
    std::fs::read_to_string(&full).unwrap_or_else(|e| panic!("{}: {e}", full.display()))
}

/// `NAME=value` from a shell script or `NAME = "value"` from a TOML file.
fn assigned(text: &str, name: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| {
            line.starts_with(&format!("{name}=")) || line.starts_with(&format!("{name} ="))
        })
        .unwrap_or_else(|| panic!("{name} is not assigned"));
    line.split_once('=')
        .unwrap()
        .1
        .trim()
        .trim_matches('"')
        .to_string()
}

#[test]
fn the_shipped_section_is_accepted() {
    let config: ServerConfig =
        toml::from_str(&repo("docker/workspace-server/kernel.toml")).expect("parses");
    let plan = plan(config.sign_in.as_ref()).expect("the shipped [sign_in] is refused");
    assert!(
        plan.turnstile.is_none(),
        "the shipped config asks for a check it has no secret for"
    );
    assert_eq!(
        plan.seed_file,
        PathBuf::from("/data/server/sign-in/oprf-seed")
    );
}

#[test]
fn the_start_script_makes_the_seed_the_config_reads() {
    let config: ServerConfig =
        toml::from_str(&repo("docker/workspace-server/kernel.toml")).expect("parses");
    let seed = config
        .sign_in
        .and_then(|s| s.oprf_seed_file)
        .expect("oprf_seed_file");
    let script = repo("docker/workspace-server/start.sh");
    assert_eq!(assigned(&script, "SEED"), seed);
    assert!(
        script.contains("--init-sign-in-seed \"$SEED\""),
        "the script does not make the seed"
    );
    let dockerfile = repo("docker/workspace-server/Dockerfile");
    let config_path = assigned(&script, "CONFIG");
    assert!(
        dockerfile.contains(&format!("kernel.toml {config_path}")),
        "the script runs another config"
    );
    assert_eq!(
        dockerfile
            .matches("CMD [\"/usr/local/bin/start-workspace-server\"]")
            .count(),
        2
    );
}

#[test]
fn the_preset_is_the_hosted_tenants_cost() {
    let wrangler = repo("deploy/tenant-worker/wrangler.toml");
    let number = |name: &str| assigned(&wrangler, name).parse::<u32>().expect(name);
    let hosted = KsfParams {
        mem_kib: number("PQ_KSF_MEM_KIB"),
        iterations: number("PQ_KSF_ITERATIONS"),
        lanes: number("PQ_KSF_LANES"),
    };
    let preset = citadel_workspace_server_kernel::kernel::sign_in::pq::ksf_preset("owasp-floor");
    assert_eq!(preset, Some(hosted));
}
