//! An earlier agent's data directory, in a scratch HOME, taken through the start-fresh sequence
//! by the shipped binary: the signal, a launcher's answer, the move to the Trash, the restart.
//!
//! The launcher here is scripted, and it is the real protocol: it reads the status file the
//! agent wrote and answers with `--start-fresh-from`, as apps/macos-agent/StartFresh.swift does,
//! which the agent's own `LauncherConsent` prompt takes as the person's answer. Nothing in the
//! agent is replaced.
//!
//! On macOS and Windows the move goes to the account's real Trash or Recycle Bin (both ignore
//! HOME): one small folder named `DATA_NAME` holding the two files written below.

mod support;

use citadel_internal_service::data_format::{AGENT_DATA_FORMAT, FORMAT_MARKER as MARKER};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

/// The contract a launcher keys on (fresh_start::START_FRESH_EXIT_CODE); the status file must
/// carry the same number, which `signal` checks.
const EXIT_CODE: i32 = 65;
const DATA_NAME: &str = "citadel-fresh-start-e2e-data";

struct Scene {
    root: PathBuf,
    home: PathBuf,
    data: PathBuf,
    status: PathBuf,
    /// Unique to this run: what identifies the folder once it is in a shared Trash.
    accounts: Vec<u8>,
}

impl Scene {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("fresh-start-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let home = root.join("home");
        // Not `.citadel-agent`: on macOS and Windows this lands in the account's real Trash, where it
        // must never be mistaken for the person's own data.
        let data = home.join(DATA_NAME);
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join(MARKER), "1").unwrap();
        let accounts = format!("an earlier agent's accounts {}", root.display()).into_bytes();
        std::fs::write(data.join("accounts.db"), &accounts).unwrap();
        let status = root.join("agent-status.json");
        Self {
            root,
            home,
            data,
            status,
            accounts,
        }
    }

    fn command(&self, bind: &str, extra: &[&str]) -> Command {
        let mut command = Command::new(support::AGENT);
        support::without_agent_env(&mut command)
            .args(support::launcher(bind, &self.data))
            .args(extra)
            .env("HOME", &self.home)
            .env("XDG_DATA_HOME", self.home.join(".local/share"))
            .env("TMPDIR", &self.root)
            .env("CITADEL_AGENT_STATUS_FILE", &self.status)
            // No desktop to ask on: the run that refuses must signal, not open a dialog.
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .stdin(Stdio::null());
        command
    }

    fn run_to_exit(&self, extra: &[&str]) -> Output {
        let mut agent = self
            .command("127.0.0.1:0", extra)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the agent binary runs");
        let started = Instant::now();
        while agent.try_wait().unwrap().is_none() {
            if started.elapsed() > Duration::from_secs(30) {
                agent.kill().unwrap();
                panic!("the agent started on an earlier agent's data");
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        agent.wait_with_output().unwrap()
    }

    fn untouched(&self) -> bool {
        std::fs::read(self.data.join("accounts.db")).is_ok_and(|b| b == self.accounts)
    }
}

impl Drop for Scene {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// What a launcher reads: the dialog's words and the directory, for this exit status only.
fn signal(scene: &Scene, output: &Output) -> serde_json::Value {
    let raw = std::fs::read(&scene.status).expect("the agent wrote its status file");
    let signal: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(
        output.status.code(),
        signal["exit_code"].as_i64().map(|c| c as i32)
    );
    signal
}

#[test]
fn an_earlier_directory_is_signalled_and_left_alone() {
    let scene = Scene::new("signal");
    let output = scene.run_to_exit(&[]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(EXIT_CODE), "{stderr}");
    let signal = signal(&scene, &output);
    assert_eq!(signal["data_dir"], scene.data.to_str().unwrap());
    assert_eq!(
        (signal["confirm"].as_str(), signal["cancel"].as_str()),
        (Some("Start fresh"), Some("Quit"))
    );
    assert!(signal["message"]
        .as_str()
        .unwrap()
        .starts_with("Citadel was updated and can't read"));
    assert!(stderr.contains("earlier version of Citadel"), "{stderr}");
    let command = if cfg!(windows) {
        "Remove-Item -LiteralPath"
    } else {
        "rm -rf -- '"
    };
    assert!(stderr.contains(command), "{stderr}");
    assert!(scene.untouched());
}

/// Negative control: consent for any directory but the one reported removes nothing.
#[test]
fn consent_for_another_directory_removes_nothing() {
    let scene = Scene::new("other");
    let home = scene.home.to_str().unwrap().to_string();
    let output = scene.run_to_exit(&["--start-fresh-from", &home]);
    assert_eq!(output.status.code(), Some(EXIT_CODE));
    assert!(scene.untouched());
    assert!(scene.data.is_dir());
}

#[test]
fn start_fresh_moves_the_directory_to_the_trash_and_the_agent_starts() {
    let scene = Scene::new("fresh");
    let refused = scene.run_to_exit(&[]);
    let dir = signal(&scene, &refused)["data_dir"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(refused.status.code(), Some(EXIT_CODE));

    // The launcher's Start fresh: the same command, and the directory the agent reported.
    let bind = free_loopback();
    let mut agent = scene
        .command(&bind.to_string(), &["--start-fresh-from", &dir])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let listening = wait_for(bind, &mut agent);
    let _ = agent.kill();
    let _ = agent.wait();
    assert!(listening, "the agent did not start after starting fresh");

    assert!(!scene.data.join("accounts.db").exists());
    assert_eq!(
        std::fs::read_to_string(scene.data.join(MARKER))
            .unwrap()
            .trim(),
        AGENT_DATA_FORMAT.to_string()
    );
    if cfg!(all(unix, not(target_os = "macos"))) {
        // freedesktop.org: restorable from the scratch HOME's own Trash, with its .trashinfo.
        let trash = scene.home.join(".local/share/Trash");
        let kept = trash.join(format!("files/{DATA_NAME}/accounts.db"));
        assert_eq!(std::fs::read(&kept).unwrap(), scene.accounts);
        assert!(trash.join(format!("info/{DATA_NAME}.trashinfo")).is_file());
    }
    #[cfg(target_os = "macos")]
    remove_from_the_real_trash(&scene);
}

fn free_loopback() -> SocketAddr {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
}

fn wait_for(addr: SocketAddr, agent: &mut std::process::Child) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(60) {
        if agent.try_wait().unwrap().is_some() {
            return false;
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// The folder this run put in the account's real Trash, found by its unique contents and removed.
/// Where this process may list the Trash, the folder must be there: it was moved, not deleted.
#[cfg(target_os = "macos")]
fn remove_from_the_real_trash(scene: &Scene) {
    let trash = PathBuf::from(std::env::var_os("HOME").unwrap()).join(".Trash");
    let Ok(entries) = std::fs::read_dir(&trash) else {
        return; // Not listable without Full Disk Access: nothing to check or remove.
    };
    let ours: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with(DATA_NAME))
        })
        .filter(|p| std::fs::read(p.join("accounts.db")).is_ok_and(|b| b == scene.accounts))
        .collect();
    assert_eq!(ours.len(), 1, "the folder is in the Trash, once: {ours:?}");
    std::fs::remove_dir_all(&ours[0]).unwrap();
}
