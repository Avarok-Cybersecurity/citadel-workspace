//! `--init-sign-in-seed` makes a sign-in seed once and never replaces it: a new seed locks out
//! every post-quantum account, so the second run must fail and leave the first seed as it was.
//!
//! Real: the shipped binary, run as an operator (or the image's start script) runs it.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Output};

fn init(path: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_citadel-workspace-server-kernel"))
        .arg("--init-sign-in-seed")
        .arg(path)
        .output()
        .expect("the server binary runs")
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn a_seed_is_made_owner_only_and_never_replaced() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("sign-in").join("oprf-seed");
    let first = init(&path);
    assert!(first.status.success(), "{}", stderr(&first));
    let seed = std::fs::read(&path).expect("the seed");
    assert_eq!(seed.len(), 32);
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let made_dir = std::fs::metadata(path.parent().unwrap()).unwrap();
    assert_eq!(made_dir.permissions().mode() & 0o777, 0o700);

    let second = init(&path);
    assert!(!second.status.success(), "a second run replaced the seed");
    assert!(
        stderr(&second).contains("refusing to replace"),
        "{}",
        stderr(&second)
    );
    assert_eq!(std::fs::read(&path).unwrap(), seed, "the seed changed");
}

#[test]
fn two_seeds_differ() {
    let dir = tempfile::tempdir().expect("temp dir");
    let (a, b) = (dir.path().join("a"), dir.path().join("b"));
    assert!(init(&a).status.success() && init(&b).status.success());
    assert_ne!(std::fs::read(a).unwrap(), std::fs::read(b).unwrap());
}

#[test]
fn a_relative_path_and_a_config_alongside_are_refused() {
    let relative = init(Path::new("oprf-seed"));
    assert!(!relative.status.success());
    assert!(
        stderr(&relative).contains("must be absolute"),
        "{}",
        stderr(&relative)
    );
    assert!(!Path::new("oprf-seed").exists());

    let dir = tempfile::tempdir().expect("temp dir");
    let both = Command::new(env!("CARGO_BIN_EXE_citadel-workspace-server-kernel"))
        .args(["--config", "kernel.toml", "--init-sign-in-seed"])
        .arg(dir.path().join("seed"))
        .output()
        .expect("runs");
    assert!(
        !both.status.success(),
        "--config and --init-sign-in-seed together were accepted"
    );
    assert!(!dir.path().join("seed").exists());
}
