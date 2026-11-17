//! What the tests that run the shipped binary share.
#![allow(dead_code)]

use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

/// The STUN servers `.env.example` ships.
pub const STUN_SERVERS: &str =
    "stun.cloudflare.com:3478,stun1.l.google.com:19302,stun4.l.google.com:19302";

/// Exactly the arguments 0.10.6's launcher passed (packaging/linux/citadel-agent-launch.in at
/// agent-v0.10.6), in its order: what a tarball or hand-run agent relaunches with after a
/// self-update.
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

/// How long the portable identity stays unlocked, which this version also requires, as the
/// packaged launchers pass it (apps/macos-agent/Info.plist's `CitadelAgentIdentityUnlockIdleSecs`).
pub const UNLOCK_IDLE_FLAG: &str = "--identity-unlock-idle-secs";

/// What this version's launchers pass: the 0.10.6 launcher's arguments and the unlock idle.
pub fn launcher(bind: &str, data_dir: &Path) -> Vec<String> {
    let mut args = launcher_0_10_6(bind, data_dir);
    args.extend([UNLOCK_IDLE_FLAG.to_string(), "900".to_string()]);
    args
}

/// `args` without `flag` and its value: a command missing a setting the agent requires,
/// which it refuses to start without.
pub fn without(args: Vec<String>, flag: &str) -> Vec<String> {
    let mut kept = Vec::with_capacity(args.len());
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == flag {
            drop(args.next());
        } else {
            kept.push(arg);
        }
    }
    kept
}

/// `args` without `--stun-servers` and its value.
pub fn without_stun(args: Vec<String>) -> Vec<String> {
    without(args, "--stun-servers")
}

/// The settings CI exports for its stack; a test that runs the binary decides them itself.
const AGENT_ENV: [&str; 3] = [
    "INTERNAL_SERVICE_ALLOWED_ORIGINS",
    "INTERNAL_SERVICE_STUN_SERVERS",
    "INTERNAL_SERVICE_IDENTITY_UNLOCK_IDLE_SECS",
];

/// This test process without any of `AGENT_ENV`, for a test whose agent production code
/// starts with this process's environment, as a relaunch does. Only for a test binary none of
/// whose tests read them.
pub fn clear_agent_env_of_this_process() {
    for name in AGENT_ENV {
        std::env::remove_var(name);
    }
}

/// `command` without any of `AGENT_ENV`.
pub fn without_agent_env(command: &mut Command) -> &mut Command {
    AGENT_ENV.iter().fold(command, |c, name| c.env_remove(name))
}

pub const AGENT: &str = env!("CARGO_BIN_EXE_citadel-workspace-internal-service");

/// Far longer than a refusal or a launch check takes (both come before anything is bound).
const EXITS_WITHIN: Duration = Duration::from_secs(30);

/// The shipped binary, run with this version's launcher arguments (without `missing` and its
/// value, when given) and `extra`, to its exit. One still running after `EXITS_WITHIN` started
/// an agent: it is killed and the test fails.
pub fn agent_that_exits(name: &str, missing: Option<&str>, extra: &[&str]) -> Output {
    let tmp = std::env::temp_dir().join(format!("agent-exits-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let launcher = launcher("127.0.0.1:0", &tmp.join("data"));
    let launcher = match missing {
        Some(flag) => without(launcher, flag),
        None => launcher,
    };
    let mut command = Command::new(AGENT);
    let mut agent = without_agent_env(&mut command)
        .args(launcher)
        .args(extra)
        .env("TMPDIR", &tmp)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the agent binary runs");
    let started = Instant::now();
    while agent.try_wait().expect("the agent's status").is_none() {
        if started.elapsed() > EXITS_WITHIN {
            agent.kill().expect("kill the agent");
            let _ = agent.wait();
            std::fs::remove_dir_all(&tmp).unwrap();
            panic!("the agent started and kept running: {extra:?}");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let output = agent.wait_with_output().expect("the agent's output");
    std::fs::remove_dir_all(&tmp).unwrap();
    output
}
