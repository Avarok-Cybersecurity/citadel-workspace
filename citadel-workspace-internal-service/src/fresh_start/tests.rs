use super::*;
use citadel_internal_service::data_format::{AGENT_DATA_FORMAT, FORMAT_MARKER};
use std::cell::RefCell;

/// The person's answer, for the sequence. A stand-in for a dialog (justified: CI has no screen
/// to show one on); the shipped askers' own answer mapping is tested beside them.
struct Says(Answer);
impl Prompt for Says {
    fn ask(&self, _offer: &Offer) -> Option<Answer> {
        Some(self.0)
    }
}

/// Deletes as asked and records it. Not the system Trash (justified: a unit test must not fill
/// the developer's own Trash); that one is exercised by tests/fresh_start_end_to_end.rs.
#[derive(Default)]
struct Recorder(RefCell<Vec<PathBuf>>);
impl Disposer for Recorder {
    fn disposal_for(&self, _dir: &Path) -> Disposal {
        Disposal::Trash
    }
    fn dispose(&self, dir: &Path, _disposal: Disposal) -> std::io::Result<()> {
        self.0.borrow_mut().push(dir.to_path_buf());
        std::fs::remove_dir_all(dir)
    }
}

fn earlier_dir() -> (tempfile::TempDir, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join(".citadel-agent");
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join(FORMAT_MARKER), "1").unwrap();
    std::fs::write(dir.join("accounts.db"), b"earlier agent").unwrap();
    (root, dir)
}

fn run(
    dir: &Path,
    prompt: &dyn Prompt,
    disposer: &Recorder,
    status: Option<&StatusFile>,
) -> Result<(), Box<dyn std::error::Error>> {
    let ports = Ports {
        prompt,
        disposer,
        status,
        home: None,
    };
    ensure_readable(dir, &ports)
}

#[test]
fn only_an_earlier_directory_is_offered() {
    assert_eq!(decide(&FormatVerdict::Proceed), Decision::Use);
    assert_eq!(
        decide(&FormatVerdict::Stamp(AGENT_DATA_FORMAT)),
        Decision::Use
    );
    assert_eq!(decide(&FormatVerdict::Earlier), Decision::Offer);
    assert_eq!(
        decide(&FormatVerdict::Newer(AGENT_DATA_FORMAT + 1)),
        Decision::Refuse
    );
}

#[test]
fn an_answer_decides_the_action_and_no_answer_is_the_signal() {
    assert_eq!(act(Some(Answer::StartFresh)), Action::StartFresh);
    assert_eq!(act(Some(Answer::Quit)), Action::Quit);
    assert_eq!(act(None), Action::Signal);
}

#[test]
fn start_fresh_disposes_of_exactly_that_directory_and_begins_a_new_one() {
    let (_root, dir) = earlier_dir();
    let disposer = Recorder::default();
    run(&dir, &Says(Answer::StartFresh), &disposer, None).unwrap();
    assert_eq!(*disposer.0.borrow(), vec![dir.clone()]);
    assert!(!dir.join("accounts.db").exists());
    assert_eq!(
        std::fs::read_to_string(dir.join(FORMAT_MARKER)).unwrap(),
        AGENT_DATA_FORMAT.to_string()
    );
}

#[test]
fn quit_removes_nothing_and_is_a_refusal_already_answered() {
    let (_root, dir) = earlier_dir();
    let disposer = Recorder::default();
    let err = run(&dir, &Says(Answer::Quit), &disposer, None).unwrap_err();
    let refused = err.downcast_ref::<Refused>().expect("a typed refusal");
    assert_eq!(
        refused,
        &Refused {
            dir: dir.clone(),
            answered: true
        }
    );
    assert!(disposer.0.borrow().is_empty());
    assert!(dir.join("accounts.db").exists());
}

#[test]
fn nobody_to_ask_writes_the_signal_and_removes_nothing() {
    let (root, dir) = earlier_dir();
    let status_path = root.path().join("status.json");
    let status = StatusFile::from_env_value(status_path.to_str()).unwrap();
    let disposer = Recorder::default();
    let err = run(&dir, &Nobody, &disposer, Some(&status)).unwrap_err();
    assert!(!err.downcast_ref::<Refused>().unwrap().answered);
    assert!(disposer.0.borrow().is_empty());
    assert!(dir.join("accounts.db").exists());
    let signal: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&status_path).unwrap()).unwrap();
    assert_eq!(signal["exit_code"], START_FRESH_EXIT_CODE);
    assert_eq!(signal["data_dir"], dir.to_str().unwrap());
    assert_eq!(signal["confirm"], "Start fresh");
    assert_eq!(signal["cancel"], "Quit");
}

#[test]
fn a_readable_or_newer_directory_is_never_offered() {
    let disposer = Recorder::default();
    let fresh = tempfile::tempdir().unwrap();
    run(fresh.path(), &Says(Answer::StartFresh), &disposer, None).unwrap();
    let newer = tempfile::tempdir().unwrap();
    std::fs::write(
        newer.path().join(FORMAT_MARKER),
        (AGENT_DATA_FORMAT + 1).to_string(),
    )
    .unwrap();
    assert!(run(newer.path(), &Says(Answer::StartFresh), &disposer, None).is_err());
    assert!(disposer.0.borrow().is_empty());
    assert!(newer.path().join(FORMAT_MARKER).exists());
}

#[test]
fn launcher_consent_is_start_fresh_for_exactly_the_reported_directory() {
    let offer = Offer {
        dir: PathBuf::from("/home/a/.citadel-agent"),
        disposal: Disposal::Trash,
    };
    let consent = |dir: Option<&str>| {
        LauncherConsent {
            dir: dir.map(PathBuf::from),
        }
        .ask(&offer)
    };
    assert_eq!(
        consent(Some("/home/a/.citadel-agent")),
        Some(Answer::StartFresh)
    );
    assert_eq!(
        consent(Some("/home/a/.citadel-agent/")),
        Some(Answer::StartFresh),
        "same path"
    );
    assert_eq!(consent(Some("/home/a")), Some(Answer::Quit));
    assert_eq!(consent(Some("/home/b/.citadel-agent")), Some(Answer::Quit));
    assert_eq!(consent(None), None);
}

#[test]
fn the_first_asker_that_can_ask_answers() {
    let offer = Offer {
        dir: PathBuf::from("/d"),
        disposal: Disposal::Trash,
    };
    let quit = Says(Answer::Quit);
    assert_eq!(
        FirstAnswer(vec![&Nobody, &quit]).ask(&offer),
        Some(Answer::Quit)
    );
    assert_eq!(FirstAnswer(vec![&Nobody]).ask(&offer), None);
}

#[test]
fn the_dialog_says_what_the_button_does_and_names_the_folder() {
    let dir = PathBuf::from("/home/a/.citadel-agent");
    let trash = dialog(&Offer {
        dir: dir.clone(),
        disposal: Disposal::Trash,
    });
    assert!(trash
        .message
        .starts_with("Citadel was updated and can't read the data from your earlier version."));
    assert!(
        trash.message.contains("restore it from there"),
        "{}",
        trash.message
    );
    assert!(trash.message.contains("/home/a/.citadel-agent"));
    assert_eq!(
        (trash.confirm.as_str(), trash.cancel.as_str()),
        ("Start fresh", "Quit")
    );
    let delete = dialog(&Offer {
        dir,
        disposal: Disposal::Delete,
    });
    assert!(
        delete.message.contains("deleted permanently"),
        "{}",
        delete.message
    );
}

#[test]
fn the_printed_command_quotes_the_folder_literally() {
    let cmd = copy::remove_command(Path::new("/home/o'brien/.citadel-agent"));
    if cfg!(windows) {
        assert_eq!(
            cmd,
            "Remove-Item -LiteralPath '/home/o''brien/.citadel-agent' -Recurse -Force"
        );
    } else {
        assert_eq!(cmd, "rm -rf -- '/home/o'\\''brien/.citadel-agent'");
    }
    let refused = Refused {
        dir: PathBuf::from("/x/.citadel-agent"),
        answered: false,
    }
    .to_string();
    assert!(
        refused.contains("earlier version of Citadel") && refused.contains("/x/.citadel-agent")
    );
}

#[cfg(all(unix, not(target_os = "macos")))]
#[test]
fn only_zenitys_ok_starts_fresh() {
    assert_eq!(prompt::answer_from_zenity(Some(0)), Answer::StartFresh);
    for other in [Some(1), Some(5), Some(-1), None] {
        assert_eq!(prompt::answer_from_zenity(other), Answer::Quit, "{other:?}");
    }
}
