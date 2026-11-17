//! `--check-launch`: what an updating agent asks a staged version before installing it
//! (citadel-internal-service's updater/launch_check.rs). The real binary answers it once every
//! required setting resolves, without binding; and the real installer, asking it with a
//! command that lacks a required setting (here the STUN servers), refuses to install a
//! version that would not start, unless the release's launch settings supply it.
#![cfg(unix)]

mod support;

use citadel_internal_service::updater::io::{Installer, Staged};
use citadel_internal_service::updater::launch_check::CHECK_LAUNCH_FLAG;
use citadel_internal_service::updater::launch_settings::{self, LaunchSettings};
use citadel_internal_service::updater::swap::SelfReplace;
use std::path::{Path, PathBuf};

const STUN_REFUSAL: &str = "no STUN servers configured";

#[test]
fn a_command_carrying_every_setting_is_answered_without_starting_an_agent() {
    let output = support::agent_that_exits("complete", None, &[CHECK_LAUNCH_FLAG]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{stderr}");
}

#[test]
fn a_command_without_the_stun_servers_is_answered_with_the_refusal() {
    let output =
        support::agent_that_exits("incomplete", Some("--stun-servers"), &[CHECK_LAUNCH_FLAG]);
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
    let path = dir.join("staged-agent");
    std::fs::copy(support::AGENT, &path).unwrap();
    let staged = Staged {
        path: path.clone(),
        launch: None,
    };
    let with_release_settings = Staged {
        path,
        launch: Some(release_launch_settings()),
    };
    let complete = support::launcher("127.0.0.1:12345", &dir.join("data"));
    let incomplete = support::without_stun(complete.clone());
    let before_identity = support::launcher_0_10_6("127.0.0.1:12345", &dir.join("data"));

    let refused = installer_relaunching_with(incomplete, &dir).can_install(&staged);
    let refused_old =
        installer_relaunching_with(before_identity.clone(), &dir).can_install(&staged);
    let updated_old =
        installer_relaunching_with(before_identity, &dir).can_install(&with_release_settings);
    let accepted = installer_relaunching_with(complete, &dir).can_install(&staged);
    std::fs::remove_dir_all(&dir).unwrap();

    let why = refused.unwrap_err();
    assert!(why.contains(STUN_REFUSAL), "{why}");
    // An agent started before the identity's timings existed is refused this version rather
    // than swapped into one that will not start: it stays put until its launcher passes them.
    let why = refused_old.unwrap_err();
    assert!(why.contains(support::UNLOCK_IDLE_FLAG), "{why}");
    assert_eq!(
        accepted,
        Ok(()),
        "the control: the same file, the setting present"
    );
    // From a version whose updater reads the release's launch settings on, the same old
    // command is completed by them, and this version is installed.
    assert_eq!(updated_old, Ok(()));
}

/// citadel-agent-launch.json as the release workflow writes it (scripts/lib/agent-settings.py
/// launch-asset), parsed by the updater.
fn release_launch_settings() -> LaunchSettings {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let output = std::process::Command::new("python3")
        .current_dir(&root)
        .args([
            "scripts/lib/agent-settings.py",
            "apps/macos-agent/Info.plist",
            "launch-asset",
            "packaging/linux/citadel-agent-launch.in",
        ])
        .output()
        .expect("python3 runs the release's asset writer");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    launch_settings::parse(&output.stdout).unwrap()
}
