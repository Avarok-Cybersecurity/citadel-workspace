//! The shipped agent sweeps staged browser uploads left by an earlier run, at every start.
//!
//! Runs the real binary (`--version` exits right after the sweep) against its own TMPDIR, so the
//! machine's real staging folder is never touched. The fresh upload is the control: it must
//! survive, or the test would pass for an agent that simply deleted everything.
//!
//! Unix only: the permission check the sweep makes (a private root) is a Unix mode check.
#![cfg(unix)]
use std::fs::{self, File};
use std::os::unix::fs::PermissionsExt;
use std::process::Command;
use std::time::{Duration, SystemTime};

#[test]
fn a_stale_staged_upload_is_removed_at_startup_and_a_fresh_one_kept() {
    let tmp = std::env::temp_dir().join(format!("agent-sweep-{}", std::process::id()));
    let root = tmp.join("citadel-browser-transfers");
    let stale = root.join("stale-transfer");
    let fresh = root.join("fresh-transfer");
    for dir in [&stale, &fresh] {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("file.bin"), b"staged bytes").unwrap();
    }
    // The sweep refuses a root anyone else can write to.
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    let two_hours_ago = SystemTime::now() - Duration::from_secs(2 * 3600);
    File::open(&stale)
        .unwrap()
        .set_modified(two_hours_ago)
        .unwrap();

    let status = Command::new(env!("CARGO_BIN_EXE_citadel-workspace-internal-service"))
        .arg("--version")
        .env("TMPDIR", &tmp)
        .status()
        .expect("the agent binary runs");
    assert!(status.success());

    assert!(
        !stale.exists(),
        "a staged upload from an earlier run is still on disk"
    );
    assert!(fresh.exists(), "a current upload was deleted");
    fs::remove_dir_all(&tmp).unwrap();
}
