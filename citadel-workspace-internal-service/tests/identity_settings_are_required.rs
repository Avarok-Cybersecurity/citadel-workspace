//! The shipped binary refuses to start without `--identity-unlock-idle-secs`, naming the flag
//! and the variable to set, before it binds anything; and answers `--check-launch` with the same
//! refusal, so an updating agent never installs a version its command cannot start. The control
//! is check_launch.rs's complete command, which starts.
#![cfg(unix)]

mod support;

use citadel_internal_service::updater::launch_check::CHECK_LAUNCH_FLAG;

const REFUSAL: &str = "no --identity-unlock-idle-secs configured";
const VARIABLE: &str = "INTERNAL_SERVICE_IDENTITY_UNLOCK_IDLE_SECS";

#[test]
fn the_agent_will_not_start_without_the_unlock_idle() {
    let output = support::agent_that_exits("start", Some(support::UNLOCK_IDLE_FLAG), &[]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success(), "started without it: {stderr}");
    assert!(stderr.contains(REFUSAL), "{stderr}");
    assert!(stderr.contains(VARIABLE), "{stderr}");
}

#[test]
fn a_launch_check_without_the_unlock_idle_is_answered_with_the_refusal() {
    let output = support::agent_that_exits(
        "check",
        Some(support::UNLOCK_IDLE_FLAG),
        &[CHECK_LAUNCH_FLAG],
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success(), "{stderr}");
    assert!(stderr.contains(REFUSAL), "{stderr}");
}
