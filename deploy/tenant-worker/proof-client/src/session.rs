//! A Citadel client the proof scripts drive one step at a time: register, connect, send a
//! workspace request, disconnect — in whatever order a proof needs, against whichever tenant.
//!
//! `run_proof` (lib.rs) is a fixed script; the durability and isolation proofs need steps on
//! either side of a server restart, and against two tenants, so they get this instead. The node
//! lives until `shutdown`, and so does its (in-memory) client account store, which is what lets
//! a proof log back in after the server restarted underneath it.

use citadel_sdk::prelude::*;
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use futures::channel::oneshot;
use futures::StreamExt;
use std::cell::RefCell;
use std::net::SocketAddr;
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

type Slot<T> = citadel_io::Mutex<Option<T>>;

/// Hands the node's remote out and holds the node open until told to stop.
struct SessionKernel {
    remote_tx: Slot<oneshot::Sender<NodeRemote<StackedRatchet>>>,
    stop_rx: Slot<oneshot::Receiver<()>>,
}

#[async_trait]
impl NetKernel<StackedRatchet> for SessionKernel {
    fn load_remote(&mut self, remote: NodeRemote<StackedRatchet>) -> Result<(), NetworkError> {
        let tx = self.remote_tx.lock().take();
        let tx = tx.ok_or_else(|| NetworkError::msg("remote loaded twice"))?;
        tx.send(remote)
            .map_err(|_| NetworkError::msg("the client went away before its node started"))
    }

    async fn on_start(&self) -> Result<(), NetworkError> {
        let stop = self.stop_rx.lock().take();
        if let Some(stop) = stop {
            let _ = stop.await;
        }
        Ok(())
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

struct Channel {
    tx: PeerChannelSendHalf<StackedRatchet>,
    rx: PeerChannelRecvHalf<StackedRatchet>,
    session: ClientServerRemote<StackedRatchet>,
}

struct Inner {
    remote: NodeRemote<StackedRatchet>,
    server_addr: SocketAddr,
    channel: RefCell<Option<Channel>>,
    stop_tx: RefCell<Option<oneshot::Sender<()>>>,
}

#[wasm_bindgen]
pub struct ProofClient {
    inner: Rc<Inner>,
}

fn js_err(e: impl std::fmt::Debug) -> JsValue {
    JsError::new(&format!("{e:?}")).into()
}

fn credentials(username: &str, password: &str) -> AuthenticationRequest {
    AuthenticationRequest::credentialed(username, password)
}

/// Start a client node dialling `endpoint`. `server_addr` is what the connection settings carry.
#[wasm_bindgen]
pub async fn start_client(
    server_addr: String,
    endpoint: String,
    log_filter: String,
) -> Result<ProofClient, JsError> {
    tenant_console_log::init(&log_filter);
    let server_addr: SocketAddr = server_addr
        .parse()
        .map_err(|e| JsError::new(&format!("bad server address: {e}")))?;
    let (remote_tx, remote_rx) = oneshot::channel();
    let (stop_tx, stop_rx) = oneshot::channel();
    let kernel = SessionKernel {
        remote_tx: citadel_io::Mutex::new(Some(remote_tx)),
        stop_rx: citadel_io::Mutex::new(Some(stop_rx)),
    };
    let node = DefaultNodeBuilder::default()
        .with_node_type(NodeType::Peer)
        .with_backend(BackendType::InMemory)
        .with_client_config(WasmClientConfig {
            use_tls: false,
            endpoint: Some(endpoint),
            pre_built_stream: None,
        })
        .build(kernel)
        .map_err(|e| JsError::new(&e.to_string()))?;
    wasm_bindgen_futures::spawn_local(async move {
        if let Err(e) = node.await {
            log::error!(target: "citadel", "[proof] client node ended: {e:?}");
        }
    });
    let remote = remote_rx
        .await
        .map_err(|_| JsError::new("the client node stopped before it started"))?;
    Ok(ProofClient {
        inner: Rc::new(Inner {
            remote,
            server_addr,
            channel: RefCell::new(None),
            stop_tx: RefCell::new(Some(stop_tx)),
        }),
    })
}

#[wasm_bindgen]
impl ProofClient {
    /// Register an account on the server. Resolves when the server accepted it.
    pub fn register(&self, username: String, password: String) -> js_sys::Promise {
        let inner = self.inner.clone();
        future_to_promise(async move {
            inner
                .remote
                .register(
                    inner.server_addr,
                    "Proof User",
                    username.as_str(),
                    password.as_str(),
                    SessionSecuritySettings::default(),
                    None,
                )
                .await
                .map_err(js_err)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Log in with an account this client registered. Resolves with the session CID.
    pub fn connect(&self, username: String, password: String) -> js_sys::Promise {
        let inner = self.inner.clone();
        future_to_promise(async move {
            let conn = inner
                .remote
                .connect(
                    credentials(&username, &password),
                    ConnectMode::default(),
                    UdpMode::Disabled,
                    None,
                    SessionSecuritySettings::default(),
                    None,
                )
                .await
                .map_err(js_err)?;
            let cid = conn.cid;
            let session = conn.remote.clone();
            let (tx, rx) = conn.split();
            *inner.channel.borrow_mut() = Some(Channel { tx, rx, session });
            Ok(JsValue::from_str(&cid.to_string()))
        })
    }

    /// Send a `WorkspaceProtocolRequest` (as JSON) and resolve with the response (as JSON).
    pub fn request(&self, request_json: String) -> js_sys::Promise {
        let inner = self.inner.clone();
        future_to_promise(async move {
            let request: WorkspaceProtocolRequest =
                serde_json::from_str(&request_json).map_err(js_err)?;
            let bytes = serde_json::to_vec(&WorkspaceProtocolPayload::Request(request))
                .map_err(js_err)?;
            let mut channel = inner
                .channel
                .borrow_mut()
                .take()
                .ok_or_else(|| js_err("not connected"))?;
            let outcome = exchange(&mut channel, bytes).await;
            *inner.channel.borrow_mut() = Some(channel);
            let response = outcome?;
            Ok(JsValue::from_str(
                &serde_json::to_string(&response).map_err(js_err)?,
            ))
        })
    }

    /// End the session with the server; the client node stays up.
    pub fn disconnect(&self) -> js_sys::Promise {
        let inner = self.inner.clone();
        future_to_promise(async move {
            let channel = inner.channel.borrow_mut().take();
            let channel = channel.ok_or_else(|| js_err("not connected"))?;
            channel.session.disconnect().await.map_err(js_err)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Stop the client node.
    pub fn shutdown(&self) -> js_sys::Promise {
        let inner = self.inner.clone();
        future_to_promise(async move {
            let _ = inner.channel.borrow_mut().take();
            let shutdown = inner.remote.shutdown().await;
            if let Some(stop) = inner.stop_tx.borrow_mut().take() {
                let _ = stop.send(());
            }
            shutdown.map_err(js_err)?;
            Ok(JsValue::UNDEFINED)
        })
    }
}

async fn exchange(
    channel: &mut Channel,
    bytes: Vec<u8>,
) -> Result<WorkspaceProtocolResponse, JsValue> {
    channel.tx.send(bytes).await.map_err(js_err)?;
    let reply = channel
        .rx
        .next()
        .await
        .ok_or_else(|| js_err("channel closed before a response arrived"))?;
    match serde_json::from_slice::<WorkspaceProtocolPayload>(reply.as_ref()) {
        Ok(WorkspaceProtocolPayload::Response(response)) => Ok(*response),
        Ok(other) => Err(js_err(format!("expected a response, got {other:?}"))),
        Err(e) => Err(js_err(format!("undecodable reply: {e}"))),
    }
}
