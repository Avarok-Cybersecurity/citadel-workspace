//! A client node whose remote a test drives directly: register, sign in with chosen factors,
//! manage those factors. The SDK's own sign-in suites drive theirs the same way.

use citadel_sdk::async_trait;
use citadel_sdk::prelude::*;
use std::future::Future;
use std::sync::Mutex;
use std::time::Duration;

/// Every run is bounded: a server that never answers fails the test instead of hanging it.
pub const MUST_FINISH_WITHIN: Duration = Duration::from_secs(120);

pub const PASSWORD: &str = "correct horse battery";

type Handler = Box<
    dyn FnOnce(
            NodeRemote<StackedRatchet>,
        ) -> futures::future::BoxFuture<'static, Result<(), NetworkError>>
        + Send,
>;

struct DriveKernel {
    remote: Option<NodeRemote<StackedRatchet>>,
    handler: Mutex<Option<Handler>>,
}

#[async_trait]
impl NetKernel<StackedRatchet> for DriveKernel {
    fn load_remote(&mut self, remote: NodeRemote<StackedRatchet>) -> Result<(), NetworkError> {
        self.remote = Some(remote);
        Ok(())
    }

    async fn on_start(&self) -> Result<(), NetworkError> {
        let remote = self.remote.clone().expect("remote loaded before start");
        let handler = self.handler.lock().unwrap().take().expect("started once");
        let result = handler(remote.clone()).await;
        let stopped = remote.shutdown().await;
        result.and(stopped)
    }

    async fn on_node_event_received(
        &self,
        _: NodeResult<StackedRatchet>,
    ) -> Result<(), NetworkError> {
        Ok(())
    }

    async fn on_stop(&mut self) -> Result<(), NetworkError> {
        Ok(())
    }
}

/// Runs `drive` on a fresh in-memory client node and returns what it returned.
pub async fn drive<F, Fut>(drive: F) -> Result<(), NetworkError>
where
    F: FnOnce(NodeRemote<StackedRatchet>) -> Fut + Send + 'static,
    Fut: Future<Output = Result<(), NetworkError>> + Send + 'static,
{
    let kernel = DriveKernel {
        remote: None,
        handler: Mutex::new(Some(Box::new(move |remote| Box::pin(drive(remote))))),
    };
    let client = DefaultNodeBuilder::default()
        .with_stun_servers(citadel_sdk::test_common::LOCALHOST_STUN_SERVERS)
        .with_backend(BackendType::InMemory)
        .with_insecure_skip_cert_verification()
        .build(kernel)
        .expect("client node");
    match tokio::time::timeout(MUST_FINISH_WITHIN, client).await {
        Ok(result) => result.map(|_| ()),
        Err(_) => Err(NetworkError::msg(format!(
            "the client did not finish within {MUST_FINISH_WITHIN:?}"
        ))),
    }
}

/// Signs `user` in with `factors`.
pub async fn sign_in(
    remote: &NodeRemote<StackedRatchet>,
    user: &str,
    factors: SignInFactors,
) -> Result<CitadelClientServerConnection<StackedRatchet>, NetworkError> {
    remote
        .connect_with_defaults(AuthenticationRequest::sign_in(user.to_string(), factors))
        .await
}

/// A unique username for one test.
pub fn username(tag: &str) -> String {
    format!("{tag}{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
}
