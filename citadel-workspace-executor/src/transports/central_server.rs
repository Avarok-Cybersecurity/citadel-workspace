use crate::{ExecutionTransport, Isolation, Result, WireRequest, WireResponse};
use async_trait::async_trait;

/// The workspace server this user is already connected to.
///
/// A subset of the SSH case: a machine we already have an authenticated,
/// encrypted channel to, so there is no second set of credentials and no second
/// thing to be down. `WorkspaceDispatch` is the seam onto that existing channel
/// — this crate does not know what a workspace protocol is, and should not.
pub struct CentralServerTransport<D> {
    dispatch: D,
}

impl<D> CentralServerTransport<D> {
    pub const fn new(dispatch: D) -> Self {
        Self { dispatch }
    }
}

/// Sends an execution request over the connection the app already holds.
#[async_trait]
pub trait WorkspaceDispatch: Send + Sync {
    async fn send(&self, request: WireRequest) -> Result<WireResponse>;
}

#[async_trait]
impl<D: WorkspaceDispatch> ExecutionTransport for CentralServerTransport<D> {
    async fn dispatch(&self, request: WireRequest) -> Result<WireResponse> {
        self.dispatch.send(request).await
    }

    fn isolation(&self) -> Isolation {
        // A different machine from the viewer's. Note what this does NOT claim:
        // the server runs the code with the server's own authority, so the
        // isolation it provides is from the *viewer*, not from the workspace.
        // Anything a document could do to the server, it still can.
        Isolation::Machine
    }

    fn name(&self) -> &'static str {
        "central-server"
    }
}
