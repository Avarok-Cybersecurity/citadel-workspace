//! Who asks the person whether to start fresh: the port, and the askers that need no shell.

use super::Offer;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Answer {
    StartFresh,
    Quit,
}

/// Asks the person about `offer`. `None`: this asker has no way to ask here (no display, no
/// dialog program, a console run), which is not an answer and removes nothing.
pub trait Prompt {
    fn ask(&self, offer: &Offer) -> Option<Answer>;
}

/// The answer a launcher already got from the person, passed as `--start-fresh-from <dir>`:
/// Start fresh for exactly that directory, and Quit for any other: a launcher naming a directory
/// this agent did not report is refused, never asked about again in this run.
pub struct LauncherConsent {
    pub dir: Option<PathBuf>,
}

impl Prompt for LauncherConsent {
    fn ask(&self, offer: &Offer) -> Option<Answer> {
        let consented = self.dir.as_ref()?;
        if *consented == offer.dir {
            return Some(Answer::StartFresh);
        }
        citadel_logging::warn!(target: "citadel",
            "--start-fresh-from names {}, which is not this agent's data directory {}; ignored",
            consented.display(), offer.dir.display());
        Some(Answer::Quit)
    }
}

/// The first asker that can ask, in order.
pub struct FirstAnswer<'a>(pub Vec<&'a dyn Prompt>);

impl Prompt for FirstAnswer<'_> {
    fn ask(&self, offer: &Offer) -> Option<Answer> {
        self.0.iter().find_map(|prompt| prompt.ask(offer))
    }
}

/// No asker in this process: on the Mac the menu-bar launcher asks, from outside it, and a
/// Windows agent with a console prints instead.
#[cfg_attr(all(unix, not(target_os = "macos")), allow(dead_code))]
pub struct Nobody;

impl Prompt for Nobody {
    fn ask(&self, _offer: &Offer) -> Option<Answer> {
        None
    }
}

/// Linux desktops: a zenity question, when this agent was started from the desktop (a display,
/// and no terminal on stdin) and zenity is installed. A terminal run keeps the printed message.
#[cfg(all(unix, not(target_os = "macos")))]
pub struct Zenity;

#[cfg(all(unix, not(target_os = "macos")))]
impl Prompt for Zenity {
    fn ask(&self, offer: &Offer) -> Option<Answer> {
        use std::io::IsTerminal;
        let display = ["DISPLAY", "WAYLAND_DISPLAY"]
            .iter()
            .any(|v| std::env::var_os(v).is_some_and(|v| !v.is_empty()));
        if !display || std::io::stdin().is_terminal() {
            return None;
        }
        let words = super::dialog(offer);
        let status = std::process::Command::new("zenity")
            .args([
                "--question",
                "--no-markup",
                "--default-cancel",
                "--width=460",
            ])
            .args(["--title", &words.title, "--text", &words.message])
            .args([
                "--ok-label",
                &words.confirm,
                "--cancel-label",
                &words.cancel,
            ])
            .status();
        match status {
            Ok(status) => Some(answer_from_zenity(status.code())),
            Err(e) => {
                citadel_logging::warn!(target: "citadel", "no start-fresh dialog: zenity: {e}");
                None
            }
        }
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
/// zenity exits 0 for the OK button and anything else for Cancel, Esc, closing or a timeout:
/// only an explicit click on the destructive button is Start fresh.
pub fn answer_from_zenity(code: Option<i32>) -> Answer {
    match code {
        Some(0) => Answer::StartFresh,
        _ => Answer::Quit,
    }
}
