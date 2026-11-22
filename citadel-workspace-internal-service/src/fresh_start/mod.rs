//! Starting fresh when the data directory is from an earlier agent.
//!
//! The format gate (citadel_internal_service::data_format) refuses an earlier agent's directory,
//! and under the alpha no-compat rule that stays. What this adds is the way out: the person is
//! asked, in their platform's own dialog, whether to move that directory to the Trash and start
//! again, instead of being handed a terminal command.
//!
//! Who asks depends on who started the agent (prompt.rs). The Mac's menu-bar launcher is a
//! separate process: this agent exits with [`START_FRESH_EXIT_CODE`] and writes the offer to the
//! status file the launcher named (status_file.rs), and the launcher asks and starts the agent
//! again with `--start-fresh-from <the directory>`. The Windows agent is its own shell, and the
//! Linux one has no shell, so both ask in this process. With nobody to ask, the refusal is printed
//! with the exact command that does the same by hand.

mod copy;
mod dispose;
mod prompt;
mod safety;
mod status_file;

pub use copy::dialog;
pub use dispose::{Disposal, Disposer, SystemDisposer};
#[cfg(all(unix, not(target_os = "macos")))]
pub use prompt::Zenity;
pub use prompt::{Answer, FirstAnswer, LauncherConsent, Prompt};
// Linux always has an asker in this process (zenity, which itself declines without a desktop).
#[cfg_attr(all(unix, not(target_os = "macos")), allow(unused_imports))]
pub use prompt::Nobody;
pub use safety::{judge, DirFacts};
pub use status_file::{StatusFile, STATUS_FILE_ENV};

use citadel_internal_service::data_format::{self, FormatVerdict};
use std::path::{Path, PathBuf};

/// The exit status of an agent that refused an earlier agent's data and was not told to start
/// fresh. Defined here only: the Mac launcher reads it from the status file rather than keeping
/// its own copy (status_file.rs). 65 is sysexits' EX_DATAERR, which nothing else here exits with.
pub const START_FRESH_EXIT_CODE: i32 = 65;

/// What is on offer: the exact directory this agent refused, and what starting fresh does to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offer {
    pub dir: PathBuf,
    pub disposal: Disposal,
}

/// What the verdict on the directory leaves to do, before anyone is asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Readable, or empty: start as usual.
    Use,
    /// An earlier agent's data: offer to start fresh.
    Offer,
    /// A newer agent's data: refused with its own message, and never offered for removal.
    Refuse,
}

pub fn decide(verdict: &FormatVerdict) -> Decision {
    match verdict {
        FormatVerdict::Proceed | FormatVerdict::Stamp(_) => Decision::Use,
        FormatVerdict::Earlier => Decision::Offer,
        FormatVerdict::Newer(_) => Decision::Refuse,
    }
}

/// What to do once the person has answered, or once it is known nobody can be asked (`None`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    StartFresh,
    /// They chose Quit: nothing is removed, and they are not asked again by this run.
    Quit,
    /// Nobody to ask: exit with the signal so a launcher can, or a person reads the command.
    Signal,
}

pub fn act(answer: Option<Answer>) -> Action {
    match answer {
        Some(Answer::StartFresh) => Action::StartFresh,
        Some(Answer::Quit) => Action::Quit,
        None => Action::Signal,
    }
}

/// The refusal of an earlier agent's directory, as a type: `main` exits with
/// [`START_FRESH_EXIT_CODE`] on it, and nothing anywhere matches on its text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refused {
    pub dir: PathBuf,
    /// The person was shown the dialog and chose Quit, so no second dialog repeats it.
    pub answered: bool,
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let copy =
            data_format::refusal_copy(&FormatVerdict::Earlier, &self.dir).unwrap_or_default();
        write!(
            f,
            "{copy}\n\nTo do that from a terminal:\n  {}",
            copy::remove_command(&self.dir)
        )
    }
}

impl std::error::Error for Refused {}

/// The I/O this needs, each behind its own port so the sequence is tested without a dialog.
pub struct Ports<'a> {
    pub prompt: &'a dyn Prompt,
    pub disposer: &'a dyn Disposer,
    pub status: Option<&'a StatusFile>,
    pub home: Option<PathBuf>,
}

/// Leaves `dir` readable by this agent, or returns why it is not: an earlier agent's directory is
/// offered for a fresh start, and only on Start fresh is that one directory disposed of.
pub fn ensure_readable(dir: &Path, ports: &Ports) -> Result<(), Box<dyn std::error::Error>> {
    let verdict = data_format::read_verdict(dir)?;
    match decide(&verdict) {
        Decision::Use | Decision::Refuse => return Ok(data_format::check_data_dir(dir)?),
        Decision::Offer => {}
    }
    let offer = Offer {
        dir: dir.to_path_buf(),
        disposal: ports.disposer.disposal_for(dir),
    };
    match act(ports.prompt.ask(&offer)) {
        Action::StartFresh => {
            judge(dir, dir, ports.home.as_deref(), &DirFacts::of(dir)?)?;
            ports.disposer.dispose(dir, offer.disposal)?;
            citadel_logging::info!(target: "citadel", "started fresh: {} ({:?})", dir.display(), offer.disposal);
            Ok(data_format::check_data_dir(dir)?)
        }
        Action::Quit => Err(Box::new(Refused {
            dir: offer.dir,
            answered: true,
        })),
        Action::Signal => {
            if let Some(status) = ports.status {
                status.write(&offer)?;
            }
            Err(Box::new(Refused {
                dir: offer.dir,
                answered: false,
            }))
        }
    }
}

#[cfg(test)]
mod safety_tests;
#[cfg(test)]
mod tests;
