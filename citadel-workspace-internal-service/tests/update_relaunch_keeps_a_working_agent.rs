//! A tarball or hand-run agent updating itself into a version that requires
//! `apps.private_network` relaunches with its old arguments, which do not carry it. The new
//! version refuses to start; the real watchdog (citadel-internal-service's updater/watchdog.rs)
//! must then put the old agent back and leave it answering. The member keeps a working agent,
//! and their self-update stays blocked until they add the flag (docs/UPGRADING.md).
//!
//! The binary under test plays three parts: the watchdog (started with its plan in
//! `CITADEL_UPDATE_WATCHDOG`, as swap.rs starts it), the new version (`target`, run with the
//! arguments given), and the old one (`backup`, run with `--apps-private-network false`
//! appended: an agent that starts with the 0.10.6 arguments, as 0.10.x did).
#![cfg(all(unix, feature = "self-update"))]

mod support;

use citadel_internal_service::updater::watchdog::{WatchPlan, WATCHDOG_ENV};
use std::net::{SocketAddr, TcpStream};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use support::AGENT;

/// What the plan names as the version being installed: the binary under test's own.
const VERSION: &str = env!("CARGO_PKG_VERSION");
/// The watchdog's own bound for a new agent to answer (`HEALTHY_WITHIN`), and so for the
/// restored one: no longer, so a slow agent is not mistaken for a working one.
const ANSWERS_WITHIN: Duration = Duration::from_secs(60);

/// Kills every agent this test started, whichever part it played, even when an assertion
/// panics: each runs in a process group of its own (watch_os.rs `detached`), named by the
/// pid its wrapper wrote.
struct Scene {
    dir: PathBuf,
}

impl Drop for Scene {
    fn drop(&mut self) {
        for pid_file in ["target.pid", "backup.pid"] {
            if let Ok(pid) = std::fs::read_to_string(self.dir.join(pid_file)) {
                let _ = Command::new("kill")
                    .args(["-s", "KILL", "--", &format!("-{}", pid.trim())])
                    // The new agent that refused to start has no group left to kill.
                    .stderr(Stdio::null())
                    .status();
            }
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn wrapper(path: &Path, pid_file: &Path, appended: &str) -> String {
    let body = format!(
        "#!/bin/sh\necho $$ > '{}'\nexec '{AGENT}' \"$@\"{appended}\n",
        pid_file.display()
    );
    std::fs::write(path, &body).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    body
}

/// A pid that has exited: the agent that started the watchdog, already gone.
fn gone_pid() -> u32 {
    let mut child = Command::new("true").spawn().unwrap();
    let pid = child.id();
    child.wait().unwrap();
    pid
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn answers_within(addr: SocketAddr, within: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < within {
        if TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

struct Run {
    scene: Scene,
    plan: WatchPlan,
    target_body: String,
    backup_body: String,
    exit: Option<i32>,
    stderr: String,
}

/// The watchdog, run to its end on a swap whose new version is started with `extra` after the
/// 0.10.6 launcher's arguments.
fn update_relaunch(name: &str, extra: &[&str]) -> Run {
    let dir = std::env::temp_dir().join(format!("agent-relaunch-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("home")).unwrap();
    let scene = Scene { dir: dir.clone() };
    let target = dir.join("citadel-agent");
    let backup = dir.join(".citadel-agent.previous");
    let target_body = wrapper(&target, &dir.join("target.pid"), "");
    let backup_body = wrapper(
        &backup,
        &dir.join("backup.pid"),
        " --apps-private-network false",
    );
    let health: SocketAddr = format!("127.0.0.1:{}", free_port()).parse().unwrap();
    let mut args = support::launcher_0_10_6(&health.to_string(), &dir.join("data"));
    args.extend(extra.iter().map(|a| a.to_string()));
    let plan = WatchPlan {
        parent_pid: gone_pid(),
        target,
        backup,
        health,
        version: VERSION.to_string(),
        args,
        failed_marker: dir.join(format!("failed-{VERSION}")),
    };
    let stderr_path = dir.join("watchdog.stderr");
    let mut command = Command::new(AGENT);
    // To a file, not a pipe: the agent the watchdog leaves running inherits it and would hold a
    // pipe open long after the watchdog exits.
    let exit = support::without_agent_env(&mut command)
        .env(WATCHDOG_ENV, serde_json::to_string(&plan).unwrap())
        // The updater's cache and anything else under the home directory stay in the scene.
        .env("HOME", dir.join("home"))
        .env("TMPDIR", &dir)
        .stdin(Stdio::null())
        .stdout(std::fs::File::create(dir.join("watchdog.stdout")).unwrap())
        .stderr(std::fs::File::create(&stderr_path).unwrap())
        .status()
        .expect("the watchdog runs")
        .code();
    let stderr = std::fs::read_to_string(&stderr_path).unwrap();
    Run {
        scene,
        plan,
        target_body,
        backup_body,
        exit,
        stderr,
    }
}

#[test]
fn an_update_relaunched_without_the_flag_is_rolled_back_to_an_agent_that_answers() {
    let run = update_relaunch("without-flag", &[]);
    let why = &run.stderr;
    assert_eq!(run.exit, Some(1), "the watchdog rolled back: {why}");
    assert!(
        why.contains("apps.private_network is not configured"),
        "{why}"
    );
    assert!(
        why.contains(&format!("rolling back {VERSION}: it exited")),
        "{why}"
    );
    assert_eq!(
        std::fs::read_to_string(&run.plan.failed_marker)
            .ok()
            .as_deref(),
        Some("it exited"),
        "{VERSION} is not retried automatically, and the agent put back can say why"
    );
    assert_eq!(
        std::fs::read_to_string(&run.plan.target).unwrap(),
        run.backup_body,
        "the old agent is back where the new one was"
    );
    assert!(
        answers_within(run.plan.health, ANSWERS_WITHIN),
        "the restored agent answers on {}: {}",
        run.plan.health,
        std::fs::read_to_string(run.scene.dir.join("watchdog.stderr")).unwrap()
    );
}

#[test]
fn the_same_update_relaunched_with_the_flag_is_kept() {
    // The control: the refusal above is the missing flag's, not the swap's or the harness's.
    let run = update_relaunch("with-flag", &["--apps-private-network", "false"]);
    let why = &run.stderr;
    assert_eq!(run.exit, Some(0), "the watchdog kept the new agent: {why}");
    assert!(
        why.contains(&format!("{VERSION} answers on {}", run.plan.health)),
        "{why}"
    );
    assert!(!run.plan.failed_marker.exists(), "{why}");
    assert_eq!(
        std::fs::read_to_string(&run.plan.target).unwrap(),
        run.target_body,
        "the new agent stays in place"
    );
    assert!(answers_within(run.plan.health, ANSWERS_WITHIN), "{why}");
}
