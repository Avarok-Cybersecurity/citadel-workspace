//! `--check-launch`: what an updating agent asks a staged version before installing it
//! (citadel-internal-service's updater/launch_check.rs). The real binary answers it once every
//! required setting resolves, without binding; and the real installer, asking it with a
//! command that lacks a required setting (here the STUN servers), refuses to install a
//! version that would not start.
#![cfg(unix)]

mod support;

use citadel_internal_service::updater::io::Installer;
use citadel_internal_service::updater::launch_check::CHECK_LAUNCH_FLAG;
use citadel_internal_service::updater::swap::SelfReplace;
use std::path::Path;

const STUN_REFUSAL: &str = "no STUN servers configured";

#[test]
fn a_command_carrying_every_setting_is_answered_without_starting_an_agent() {
    let output = support::agent_that_exits("complete", true, &[CHECK_LAUNCH_FLAG]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{stderr}");
}

#[test]
fn a_command_without_the_stun_servers_is_answered_with_the_refusal() {
    let output = support::agent_that_exits("incomplete", false, &[CHECK_LAUNCH_FLAG]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success());
    assert!(stderr.contains(STUN_REFUSAL), "{stderr}");
}

fn installer_relaunching_with(args: Vec<String>, dir: &Path) -> SelfReplace {
    SelfReplace::new(
        dir.join("installed"),
        args,
        "127.0.0.1:12345".parse().unwrap(),
        dir.to_path_buf(),
        || unreachable!("nothing is installed"),
    )
}

#[test]
fn an_agent_whose_command_lacks_a_setting_will_not_install_this_version() {
    // The check passes the agent's own environment on; CI's would supply the setting.
    support::clear_agent_env_of_this_process();
    let dir = std::env::temp_dir().join(format!("agent-check-launch-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let staged = dir.join("staged-agent");
    std::fs::copy(support::AGENT, &staged).unwrap();
    let complete = support::launcher_0_10_6("127.0.0.1:12345", &dir.join("data"));
    let incomplete = support::without_stun(complete.clone());

    let refused = installer_relaunching_with(incomplete, &dir).can_install(&staged);
    let accepted = installer_relaunching_with(complete, &dir).can_install(&staged);
    std::fs::remove_dir_all(&dir).unwrap();

    let why = refused.unwrap_err();
    assert!(why.contains(STUN_REFUSAL), "{why}");
    assert_eq!(
        accepted,
        Ok(()),
        "the control: the same file, the setting present"
    );
}
