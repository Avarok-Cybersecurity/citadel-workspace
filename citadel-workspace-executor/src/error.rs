use std::fmt::Debug;

/// Why a piece of code did not run, or did not produce a usable answer.
///
/// Deliberately distinguishes "the code ran and failed" from "we would not run
/// it" and "we could not reach the place that runs it". Collapsing those into
/// one error is how a refused execution comes to look like a broken document.
#[derive(Debug, thiserror::Error)]
pub enum ExecutionError {
    /// The policy refused. Carries what was asked for and what was offered, so
    /// the message can say why rather than "not allowed".
    #[error(
        "refused to run {entry_point} ({trust}) on an executor providing {isolation}: {reason}"
    )]
    Refused {
        entry_point: &'static str,
        trust: &'static str,
        isolation: &'static str,
        reason: &'static str,
    },

    /// The executor could not be reached, or gave up waiting.
    #[error("could not reach the executor for {entry_point}: {source_message}")]
    Unreachable {
        entry_point: &'static str,
        source_message: String,
    },

    /// The code ran and failed on its own terms.
    #[error("{entry_point} failed: {message}")]
    Failed {
        entry_point: &'static str,
        message: String,
    },

    /// The payload or the answer would not cross the wire.
    #[error("could not encode/decode {entry_point}: {message}")]
    Encoding {
        entry_point: &'static str,
        message: String,
    },

    /// A transport that exists as a type but has no implementation yet.
    ///
    /// Loud on purpose. A stub that silently fell back to running the code
    /// locally would defeat the entire point of choosing a remote executor.
    #[error("the {transport} executor is not implemented; refusing to run {entry_point} somewhere it was not asked to run")]
    NotImplemented {
        transport: &'static str,
        entry_point: &'static str,
    },
}

pub type Result<T> = std::result::Result<T, ExecutionError>;
