//! A Citadel client, compiled to wasm and run under Node, that drives the tenant worker end to
//! end: register an account, connect, round-trip workspace requests, disconnect, log back in.
//!
//! It is the SDK's own browser client (the WebSocket transport in `wasm_io`), not a stand-in:
//! every byte it sends crosses the Durable Object's WebSocket into the Citadel node there.

mod session;

use citadel_sdk::prelude::*;
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use futures::StreamExt;
use std::sync::Arc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

/// What the run measured, in milliseconds of client wall time, plus what the server answered.
#[derive(Default)]
struct Report {
    register_ms: f64,
    connect_ms: f64,
    requests_ms: Vec<f64>,
    responses: Vec<String>,
    login_ms: f64,
    login_request_ms: f64,
    cid: u64,
    /// How `run` ended. `None` means it never finished, which is a failure like any error: the
    /// executor does not propagate `on_start`'s result, so this is the only evidence the steps ran.
    outcome: Option<Result<(), String>>,
}

impl Report {
    fn to_json(&self) -> String {
        serde_json::json!({
            "register_ms": self.register_ms,
            "connect_ms": self.connect_ms,
            "requests_ms": self.requests_ms,
            "responses": self.responses,
            "login_ms": self.login_ms,
            "login_request_ms": self.login_request_ms,
            "cid": self.cid.to_string(),
        })
        .to_string()
    }
}

struct ProofKernel {
    remote: citadel_io_mutex::Mutex<Option<NodeRemote<StackedRatchet>>>,
    server_addr: std::net::SocketAddr,
    username: String,
    password: String,
    requests: u32,
    report: Arc<citadel_io_mutex::Mutex<Report>>,
    /// Called with a phase name as each phase ends, so the harness can sample the server's CPU
    /// at the boundary. Synchronous on purpose: the client does nothing while it samples.
    on_phase: SendFunction,
}

/// `js_sys::Function` is `!Send`; wasm32 is single-threaded, and `NetKernel` demands `Send`.
struct SendFunction(js_sys::Function);
unsafe impl Send for SendFunction {}
unsafe impl Sync for SendFunction {}

impl SendFunction {
    fn mark(&self, phase: &str) {
        let _ = self.0.call1(&JsValue::NULL, &phase.into());
    }
}

/// The SDK's lock type on this target, so the kernel stays `Send + Sync` as `NetKernel` demands.
mod citadel_io_mutex {
    pub use citadel_io::Mutex;
}

async fn round_trip(
    tx: &mut PeerChannelSendHalf<StackedRatchet>,
    rx: &mut PeerChannelRecvHalf<StackedRatchet>,
    request: WorkspaceProtocolRequest,
) -> Result<(f64, WorkspaceProtocolResponse), NetworkError> {
    let bytes = serde_json::to_vec(&WorkspaceProtocolPayload::Request(request))
        .map_err(|e| NetworkError::msg(e.to_string()))?;
    let t0 = performance_now();
    tx.send(bytes).await?;
    let reply = rx
        .next()
        .await
        .ok_or_else(|| NetworkError::msg("channel closed before a response arrived"))?;
    let elapsed = performance_now() - t0;
    match serde_json::from_slice::<WorkspaceProtocolPayload>(reply.as_ref()) {
        Ok(WorkspaceProtocolPayload::Response(response)) => Ok((elapsed, *response)),
        Ok(other) => Err(NetworkError::msg(format!(
            "expected a response, got {other:?}"
        ))),
        Err(e) => Err(NetworkError::msg(format!("undecodable reply: {e}"))),
    }
}

impl ProofKernel {
    async fn run(&self, remote: NodeRemote<StackedRatchet>) -> Result<(), NetworkError> {
        let t0 = performance_now();
        let _ = remote
            .register(
                self.server_addr,
                "Proof User",
                self.username.as_str(),
                self.password.as_str(),
                SessionSecuritySettings::default(),
                None,
            )
            .await?;
        let t1 = performance_now();
        self.on_phase.mark("register");
        let conn = remote
            .connect(
                AuthenticationRequest::credentialed(self.username.as_str(), self.password.as_str()),
                ConnectMode::default(),
                UdpMode::Disabled,
                None,
                SessionSecuritySettings::default(),
                None,
            )
            .await?;
        let t2 = performance_now();
        self.on_phase.mark("connect");
        {
            let mut r = self.report.lock();
            r.register_ms = t1 - t0;
            r.connect_ms = t2 - t1;
            r.cid = conn.cid;
        }
        log::info!(target: "citadel", "[proof] registered and connected as cid={}", conn.cid);

        let session = conn.remote.clone();
        let (mut tx, mut rx) = conn.split();
        for i in 0..self.requests {
            let request = if i % 2 == 0 {
                WorkspaceProtocolRequest::GetWorkspace { workspace_id: None }
            } else {
                WorkspaceProtocolRequest::GetServerCapabilities
            };
            let (ms, response) = round_trip(&mut tx, &mut rx, request).await?;
            let mut r = self.report.lock();
            r.requests_ms.push(ms);
            r.responses
                .push(format!("{response:?}").chars().take(160).collect());
        }

        self.on_phase.mark("requests");
        session.disconnect().await?;
        drop((tx, rx));
        self.on_phase.mark("disconnect");

        let t3 = performance_now();
        let conn = remote
            .connect(
                AuthenticationRequest::credentialed(self.username.as_str(), self.password.as_str()),
                ConnectMode::default(),
                UdpMode::Disabled,
                None,
                SessionSecuritySettings::default(),
                None,
            )
            .await?;
        let t4 = performance_now();
        self.on_phase.mark("login");
        let (mut tx, mut rx) = conn.split();
        let (ms, response) = round_trip(
            &mut tx,
            &mut rx,
            WorkspaceProtocolRequest::GetWorkspace { workspace_id: None },
        )
        .await?;
        self.on_phase.mark("login_request");
        {
            let mut r = self.report.lock();
            r.login_ms = t4 - t3;
            r.login_request_ms = ms;
            r.responses.push(
                format!("after login: {response:?}")
                    .chars()
                    .take(160)
                    .collect(),
            );
        }
        Ok(())
    }
}

#[async_trait]
impl NetKernel<StackedRatchet> for ProofKernel {
    fn load_remote(&mut self, remote: NodeRemote<StackedRatchet>) -> Result<(), NetworkError> {
        *self.remote.lock() = Some(remote);
        Ok(())
    }

    async fn on_start(&self) -> Result<(), NetworkError> {
        let remote = self
            .remote
            .lock()
            .clone()
            .expect("remote loaded before start");
        let outcome = self.run(remote.clone()).await;
        self.report.lock().outcome =
            Some(outcome.as_ref().map(|_| ()).map_err(|e| format!("{e:?}")));
        let _ = remote.shutdown().await;
        outcome
    }

    async fn on_node_event_received(
        &self,
        _message: NodeResult<StackedRatchet>,
    ) -> Result<(), NetworkError> {
        Ok(())
    }

    async fn on_stop(&mut self) -> Result<(), NetworkError> {
        Ok(())
    }
}

/// Run the proof. `server_addr` is what the connection settings carry; `endpoint`, when given,
/// is the WebSocket URL actually dialled (a hostname and path the address cannot express).
/// Resolves with a JSON report, rejects with the first error.
#[wasm_bindgen]
pub async fn run_proof(
    server_addr: String,
    endpoint: Option<String>,
    username: String,
    password: String,
    requests: u32,
    log_filter: String,
    on_phase: js_sys::Function,
) -> Result<String, JsError> {
    tenant_console_log::init(&log_filter);
    let server_addr: std::net::SocketAddr = server_addr
        .parse()
        .map_err(|e| JsError::new(&format!("bad server address: {e}")))?;
    let report = Arc::new(citadel_io_mutex::Mutex::new(Report::default()));
    let kernel = ProofKernel {
        remote: citadel_io_mutex::Mutex::new(None),
        server_addr,
        username,
        password,
        requests,
        report: report.clone(),
        on_phase: SendFunction(on_phase),
    };
    let client_config = WasmClientConfig {
        use_tls: false,
        endpoint,
        pre_built_stream: None,
    };
    DefaultNodeBuilder::default()
        .with_node_type(NodeType::Peer)
        .with_backend(BackendType::InMemory)
        .with_client_config(client_config)
        .build(kernel)
        .map_err(|e| JsError::new(&e.to_string()))?
        .await
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    let report = report.lock();
    match &report.outcome {
        Some(Ok(())) => Ok(report.to_json()),
        Some(Err(e)) => Err(JsError::new(&format!("proof step failed: {e}"))),
        None => Err(JsError::new(
            "the node stopped before the proof ran to completion",
        )),
    }
}
