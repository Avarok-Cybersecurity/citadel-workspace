//! The shipped agent refuses to start until `apps.private_network` is configured, and reads
//! it from its command line: no default reaches host egress.
//!
//! Runs the real binary with exactly the arguments 0.10.6's launcher passed
//! (packaging/linux/citadel-agent-launch.in at agent-v0.10.6): the command a tarball or
//! hand-run agent relaunches with after a self-update, so the only thing missing is the one
//! under test. Both runs exit before anything listens; one that is still running
//! after `STARTUP_MS` started without the setting, and is killed and failed.
mod support;

use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

/// Far longer than the refusal takes (it comes before the socket is bound).
const STARTUP_MS: u64 = 30_000;

fn agent(extra: &[&str]) -> Output {
    let tmp = std::env::temp_dir().join(format!(
        "agent-private-net-{}-{}",
        std::process::id(),
        extra.len()
    ));
    std::fs::create_dir_all(&tmp).unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_citadel-workspace-internal-service"));
    let mut output = support::without_agent_env(&mut command)
        .args(support::launcher_0_10_6("127.0.0.1:0", &tmp.join("data")))
        .args(extra)
        .env("TMPDIR", &tmp)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the agent binary runs");
    let started = Instant::now();
    while output.try_wait().expect("the agent's status").is_none() {
        if started.elapsed() > Duration::from_millis(STARTUP_MS) {
            output.kill().expect("kill the agent");
            let _ = output.wait();
            std::fs::remove_dir_all(&tmp).unwrap();
            panic!("the agent started and kept running: {extra:?}");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let output = output.wait_with_output().expect("the agent's output");
    std::fs::remove_dir_all(&tmp).unwrap();
    output
}

#[test]
fn the_last_shipped_launchers_arguments_are_refused_naming_the_flag() {
    let output = agent(&[]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success());
    // The refusal is all a member who relaunched by hand sees: it must name what to add.
    for named in [
        "apps.private_network is not configured",
        "--apps-private-network",
        "INTERNAL_SERVICE_APPS_PRIVATE_NETWORK",
    ] {
        assert!(stderr.contains(named), "{named} missing from: {stderr}");
    }
}

#[test]
fn the_setting_is_read_from_the_command_line() {
    // The control: the refusal above is the missing setting's, and the flag reaches the check.
    let output = agent(&["--apps-private-network", "maybe"]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success());
    assert!(
        stderr.contains("invalid --apps-private-network"),
        "{stderr}"
    );
}
