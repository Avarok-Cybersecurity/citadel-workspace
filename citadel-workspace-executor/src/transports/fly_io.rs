use crate::{ExecutionError, ExecutionTransport, Isolation, Result, WireRequest, WireResponse};
use async_trait::async_trait;

/// An ephemeral machine, created for the work and destroyed after it.
///
/// Declared, not implemented — see `SshRemoteTransport` for why the stub
/// refuses rather than falling back.
///
/// Worth recording while the shape is fresh: this is the only destination here
/// whose isolation improves with *time* as well as space, because the machine
/// does not outlive the request. That matters for `Trust::Anonymous` work,
/// where a persistent host accumulates whatever each execution left behind.
pub struct FlyIoTransport {
    pub app: String,
}

impl FlyIoTransport {
    pub const fn new(app: String) -> Self {
        Self { app }
    }
}

#[async_trait]
impl ExecutionTransport for FlyIoTransport {
    async fn dispatch(&self, request: WireRequest) -> Result<WireResponse> {
        Err(ExecutionError::NotImplemented {
            transport: "fly.io",
            entry_point: request.entry_point,
        })
    }

    fn isolation(&self) -> Isolation {
        Isolation::Machine
    }

    fn name(&self) -> &'static str {
        "fly.io"
    }
}
