//! A native server will not start without saying how people sign in, and refuses a `[sign_in]`
//! it cannot honour: a missing, short, long, shared or symlinked seed, a cost below the floor,
//! an unset secret, Turnstile keys nothing would read. Each refusal names what is wrong.
//!
//! Real: `native_sign_in`, the function `run_server_with_base_path` calls, over real files. The
//! environment is passed in, so no test here writes the process's own.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::sign_in::config::NativeSignInConfig;
use citadel_workspace_server_kernel::kernel::sign_in::native::{init_sign_in_seed, native_sign_in};
use citadel_workspace_server_kernel::kernel::sign_in::turnstile::{
    SiteVerify, SiteVerifyUnreachable,
};
use citadel_workspace_server_kernel::kernel::sign_in::HostedSignIn;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Startup never asks siteverify; reaching it is a failure.
struct Unreached;

#[async_trait::async_trait]
impl SiteVerify for Unreached {
    async fn verify(
        &self,
        _: &str,
        _: &str,
        _: Option<&str>,
    ) -> Result<serde_json::Value, SiteVerifyUnreachable> {
        panic!("siteverify was asked at startup")
    }
}

fn dir() -> PathBuf {
    let dir = tempfile::tempdir().expect("temp dir").keep();
    init_sign_in_seed(&dir.join("oprf-seed")).expect("seed");
    dir
}

fn section(toml: &str) -> NativeSignInConfig {
    toml::from_str(toml).expect("parses")
}

fn none(seed: &Path) -> String {
    format!(
        "oprf_seed_file = \"{}\"\nksf = \"owasp-floor\"\nadmission = \"none\"\n",
        seed.display()
    )
}

fn turnstile(dir: &Path) -> String {
    format!(
        "oprf_seed_file = \"{}\"\nksf = \"owasp-floor\"\nadmission = \"turnstile\"\n\
         turnstile_secret_env = \"TS_SECRET\"\nturnstile_site_key = \"1x00000000000000000000AA\"\n\
         turnstile_hostnames = [\"example.com\"]\nturnstile_cdata = \"acme\"\n\
         settings_file = \"{}\"\n",
        dir.join("oprf-seed").display(),
        dir.join("settings.json").display()
    )
}

fn start(toml: &str, secret: Option<&str>) -> Result<HostedSignIn, String> {
    let secret = secret.map(str::to_string);
    native_sign_in(
        Some(&section(toml)),
        &|name| (name == "TS_SECRET").then(|| secret.clone()).flatten(),
        Arc::new(Unreached),
    )
}

fn refusal(toml: &str, secret: Option<&str>) -> String {
    match start(toml, secret) {
        Ok(_) => panic!("started with {toml}"),
        Err(reason) => reason,
    }
}

#[test]
fn a_good_section_starts_post_quantum_with_or_without_the_check() {
    let dir = dir();
    let plain = start(&none(&dir.join("oprf-seed")), None).expect("admission = none");
    assert!(plain.pq_sign_in.is_some() && plain.admission.is_none() && plain.settings.is_some());
    let checked = start(&turnstile(&dir), Some("a-secret")).expect("admission = turnstile");
    assert!(
        checked.pq_sign_in.is_some() && checked.admission.is_some() && checked.settings.is_some()
    );
}

#[test]
fn no_section_is_refused() {
    let refused = native_sign_in(None, &|_| None, Arc::new(Unreached))
        .err()
        .expect("refused");
    assert!(refused.contains("no [sign_in] section"), "{refused}");
}

#[test]
fn a_seed_that_is_missing_short_long_shared_or_a_link_is_refused() {
    let dir = dir();
    let missing = refusal(&none(&dir.join("absent")), None);
    assert!(missing.contains("--init-sign-in-seed"), "{missing}");
    for (name, len) in [("short", 31), ("long", 33)] {
        let path = dir.join(name);
        std::fs::write(&path, vec![1u8; len]).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let refused = refusal(&none(&path), None);
        assert!(refused.contains("is not 32 bytes"), "{name}: {refused}");
    }
    let shared = dir.join("shared");
    std::fs::copy(dir.join("oprf-seed"), &shared).unwrap();
    for mode in [0o644, 0o640, 0o604, 0o660] {
        std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(mode)).unwrap();
        let refused = refusal(&none(&shared), None);
        assert!(refused.contains("must be 600"), "{mode:o}: {refused}");
    }
    let link = dir.join("link");
    std::os::unix::fs::symlink(dir.join("oprf-seed"), &link).unwrap();
    assert!(refusal(&none(&link), None).contains("not a regular file"));
}

#[test]
fn the_cost_is_a_preset_or_three_numbers_and_never_below_the_floor() {
    let seed = dir().join("oprf-seed");
    let base = format!(
        "oprf_seed_file = \"{}\"\nadmission = \"none\"\n",
        seed.display()
    );
    for (ksf, expect) in [
        ("", "exactly one of"),
        ("ksf = \"fast\"\n", "not a preset"),
        ("ksf = \"owasp-floor\"\nksf_lanes = 1\n", "exactly one of"),
        (
            "ksf_mem_kib = 19456\nksf_iterations = 2\n",
            "exactly one of",
        ),
        (
            "ksf_mem_kib = 1024\nksf_iterations = 2\nksf_lanes = 1\n",
            "below the floor",
        ),
    ] {
        let refused = refusal(&format!("{base}{ksf}"), None);
        assert!(refused.contains(expect), "{ksf:?}: {refused}");
    }
    start(
        &format!("{base}ksf_mem_kib = 65536\nksf_iterations = 3\nksf_lanes = 4\n"),
        None,
    )
    .expect("explicit cost");
}

#[test]
fn admission_must_be_named_and_none_takes_no_turnstile_keys() {
    let dir = dir();
    let seed = dir.join("oprf-seed");
    let unnamed = refusal(
        &format!(
            "oprf_seed_file = \"{}\"\nksf = \"owasp-floor\"\n",
            seed.display()
        ),
        None,
    );
    assert!(unnamed.contains("admission is required"), "{unnamed}");
    let stray = refusal(
        &format!("{}turnstile_secret_env = \"TS_SECRET\"\n", none(&seed)),
        None,
    );
    assert!(stray.contains("nothing would read it"), "{stray}");
    let stray_key = refusal(
        &format!("{}turnstile_site_key = \"k\"\n", none(&seed)),
        None,
    );
    assert!(
        stray_key.contains("turnstile_site_key") && stray_key.contains("nothing would read it"),
        "{stray_key}"
    );
    assert!(toml::from_str::<NativeSignInConfig>("admission = \"maybe\"").is_err());
    assert!(
        toml::from_str::<NativeSignInConfig>("admision = \"none\"").is_err(),
        "a misspelt key was ignored"
    );
}

#[test]
fn turnstile_needs_its_secret_and_every_key() {
    let dir = dir();
    let unset = refusal(&turnstile(&dir), None);
    assert!(
        unset.contains("TS_SECRET") && unset.contains("not set"),
        "{unset}"
    );
    assert!(refusal(&turnstile(&dir), Some("  ")).contains("not set"));
    for (key, broken) in [
        ("turnstile_hostnames", "turnstile_hostnames = []"),
        ("turnstile_cdata", "turnstile_cdata = \"work.example.com\""),
        ("turnstile_site_key", "turnstile_site_key = \"\""),
        ("turnstile_site_key", "turnstile_site_key = \"a key\""),
        ("turnstile_secret_env", "turnstile_secret_env = \"1X\""),
    ] {
        let toml: String = turnstile(&dir)
            .lines()
            .map(|line| if line.starts_with(key) { broken } else { line })
            .collect::<Vec<_>>()
            .join("\n");
        assert!(refusal(&toml, Some("a-secret")).contains(key), "{key}");
    }
    let relative = turnstile(&dir).replace(
        &dir.join("settings.json").display().to_string(),
        "settings.json",
    );
    assert!(refusal(&relative, Some("a-secret")).contains("absolute path"));
    std::fs::write(dir.join("settings.json"), "{\"require\":true}").unwrap();
    assert!(refusal(&turnstile(&dir), Some("a-secret")).contains("malformed"));
}

#[test]
fn kernel_toml_sign_in_is_read_into_the_config() {
    let config: ServerConfig = toml::from_str(&format!(
        "bind_addr = \"127.0.0.1:0\"\n[sign_in]\n{}",
        none(&dir().join("oprf-seed"))
    ))
    .expect("config");
    assert!(
        config.sign_in.is_some(),
        "kernel.toml's [sign_in] is not read into the config"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn startup_fails_without_the_section() {
    let config: ServerConfig = toml::from_str(
        "bind_addr = \"127.0.0.1:0\"\nworkspace_master_password = \"a-test-master-password\"\n\
         require_platform_terms = false\nsecure_links_per_member = 5\nsecure_links_pool = 0\n",
    )
    .expect("config");
    let refused = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        citadel_workspace_server_kernel::run_server_with_base_path(config, None),
    )
    .await
    .expect("refuses at once rather than serving");
    let error = format!(
        "{:?}",
        refused.expect_err("a server without [sign_in] started")
    );
    assert!(error.contains("[sign_in]"), "{error}");
}
