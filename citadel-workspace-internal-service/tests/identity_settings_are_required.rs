//! The shipped binary refuses to start without each of the portable identity's timings, naming
//! the flag and the variable to set, before it binds anything; and answers `--check-launch`
//! with the same refusal, so an updating agent never installs a version its command cannot
//! start. The control is check_launch.rs's complete command, which starts.
#![cfg(unix)]

mod support;

use citadel_internal_service::updater::launch_check::CHECK_LAUNCH_FLAG;

fn variable_of(flag: &str) -> String {
    let name = flag.trim_start_matches("--identity-").replace('-', "_");
    format!("INTERNAL_SERVICE_IDENTITY_{}", name.to_uppercase())
}

#[test]
fn the_agent_will_not_start_without_any_one_of_the_identity_timings() {
    for flag in support::IDENTITY_FLAGS {
        let output = support::agent_that_exits(&format!("start{flag}"), Some(flag), &[]);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(!output.status.success(), "started without {flag}: {stderr}");
        assert!(
            stderr.contains(&format!("no {flag} configured")),
            "{stderr}"
        );
        assert!(stderr.contains(&variable_of(flag)), "{stderr}");
    }
}

#[test]
fn a_launch_check_without_an_identity_timing_is_answered_with_the_refusal() {
    for flag in support::IDENTITY_FLAGS {
        let output =
            support::agent_that_exits(&format!("check{flag}"), Some(flag), &[CHECK_LAUNCH_FLAG]);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(!output.status.success(), "{flag}: {stderr}");
        assert!(
            stderr.contains(&format!("no {flag} configured")),
            "{stderr}"
        );
    }
}
