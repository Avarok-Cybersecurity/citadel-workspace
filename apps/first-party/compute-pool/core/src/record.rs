//! One finished job as `storage.user` keeps it, and what it says about who did the work. The
//! record holds the facts (who answered, what the check found); [`Outcome`] is derived from them,
//! and [`Outcome::wording`] is the one place a job's outcome is put into words.

use crate::jobs::{Job, JobResult};
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    pub job_id: u64,
    pub job: Job,
    pub result: JobResult,
    /// The members whose chunks are in the result, by name. Empty: nobody else was involved.
    /// Absent from records written before it was kept: such a record says nothing about it.
    #[serde(default)]
    pub helpers: Vec<String>,
    /// What the spot check found. `None` only in a record written before the check was kept: its
    /// one-word `verified` could not tell a member's checked chunk from a job done here alone, so
    /// it is not read, and the outcome is shown as not recorded rather than guessed. (serde reads a
    /// missing `Option` field as `None`.)
    pub check: Option<Check>,
    pub ms: u32,
}

/// The spot check of one member's chunk against this member's own computation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Check {
    Agreed,
    Disagreed,
    /// No member's chunk was in the result: there was nothing of anyone else's to check.
    NothingTheirs,
}

/// What a finished job amounts to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Members answered, and the chunk checked here agreed.
    Verified,
    /// A member's checked chunk did not agree; it was recomputed here.
    WrongAnswer,
    /// No member answered: every chunk was computed on this device, so nothing was checked.
    Local,
    /// A record from before the outcome was kept.
    NotRecorded,
}

impl Record {
    pub fn outcome(&self) -> Outcome {
        match self.check {
            Some(Check::Agreed) => Outcome::Verified,
            Some(Check::Disagreed) => Outcome::WrongAnswer,
            Some(Check::NothingTheirs) => Outcome::Local,
            None => Outcome::NotRecorded,
        }
    }
}

impl Outcome {
    pub fn wording(self) -> &'static str {
        match self {
            Outcome::Verified => "verified",
            Outcome::WrongAnswer => "wrong answer",
            Outcome::Local => "computed on this device",
            Outcome::NotRecorded => "outcome not recorded",
        }
    }
}

#[cfg(test)]
#[path = "record_tests.rs"]
mod tests;
