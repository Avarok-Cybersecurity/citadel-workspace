/// Who wrote the code, which is the question that decides where it may run.
///
/// This is the field the MDX renderer did not have. A workspace document is
/// `Member` code: authored by anyone with edit rights on a node, pushed live to
/// every open viewer. It was being executed with `new Function` in the viewer's
/// main thread, which is `Isolation::None` — and the only reason that was not a
/// standing account-takeover was a Content-Security-Policy that happened to
/// forbid it, silently, in production only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trust {
    /// Shipped with the application. Reviewed, versioned, signed by the build.
    FirstParty,
    /// Written by an authenticated member of the workspace.
    Member,
    /// Written by anyone at all, including someone outside the workspace.
    Anonymous,
}

impl Trust {
    pub const fn as_str(self) -> &'static str {
        match self {
            Trust::FirstParty => "first-party code",
            Trust::Member => "member-authored code",
            Trust::Anonymous => "untrusted code",
        }
    }

    /// The weakest isolation this code may be run under.
    ///
    /// First-party code is the only kind allowed to share an address space with
    /// the application, and even that is a statement about the build pipeline
    /// rather than about the code.
    pub const fn minimum_isolation(self) -> crate::Isolation {
        match self {
            Trust::FirstParty => crate::Isolation::None,
            Trust::Member => crate::Isolation::Process,
            Trust::Anonymous => crate::Isolation::Machine,
        }
    }
}

/// Data that carries its own code and knows how to start it.
///
/// `execute` is what happens *at the destination*. An executor's job is to get
/// this to a place where running it is acceptable and to bring the output back;
/// it is not to decide what the code does.
pub trait ExecutableEntryPoint: Send + 'static {
    /// What running it produces.
    type Output: Send + 'static;

    /// Stable name, used for wire dispatch and for every error message. A
    /// literal rather than a method so an error can name the work even when the
    /// value itself is gone.
    const NAME: &'static str;

    /// Where this code came from. Chosen by the type, not by the caller: a
    /// caller who could relax it would relax it under deadline.
    const TRUST: Trust;

    fn execute(self) -> crate::Result<Self::Output>;
}
