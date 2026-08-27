use crate::{ExecutionError, ExecutionTransport, Isolation, Result, WireRequest, WireResponse};
use async_trait::async_trait;

/// A machine reachable over SSH.
///
/// Declared, not implemented. The type exists so the shape of the seam is
/// settled — a destination is a transport, nothing more — and so that choosing
/// it is a visible decision rather than a TODO in a comment.
///
/// `dispatch` returns `NotImplemented` rather than falling back to anything.
/// A stub that quietly ran the work locally would be worse than no stub at all:
/// the caller asked for another machine precisely because this machine will not
/// do, and would get the opposite of what it asked for, silently.
pub struct SshRemoteTransport {
    pub host: String,
}

impl SshRemoteTransport {
    pub const fn new(host: String) -> Self {
        Self { host }
    }
}

#[async_trait]
impl ExecutionTransport for SshRemoteTransport {
    async fn dispatch(&self, request: WireRequest) -> Result<WireResponse> {
        Err(ExecutionError::NotImplemented {
            transport: "SSH",
            entry_point: request.entry_point,
        })
    }

    fn isolation(&self) -> Isolation {
        Isolation::Machine
    }

    fn name(&self) -> &'static str {
        "ssh"
    }
}
