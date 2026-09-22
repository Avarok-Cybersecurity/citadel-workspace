//! The workspace server, compiled for a Durable Object.
//!
//! JS owns the sockets: the Durable Object accepts each WebSocket upgrade and hands the server
//! half here. Rust owns everything else — the Citadel node, the workspace kernel, the sessions —
//! running on the isolate's event loop for as long as the object lives. Its accounts and
//! workspace data live in the object's own SQLite storage (`storage`), so they outlive it.

mod storage;

use citadel_sdk::prelude::{
    ArgonDefaultServerSettings, BackendType, WasmConnectionInjector, WasmIO, WasmListener,
    WasmStream, WasmWebSocketStream,
};
use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::run_server_on;
use std::cell::Cell;
use std::sync::OnceLock;
use std::net::{Ipv4Addr, SocketAddr};
use wasm_bindgen::prelude::*;

/// Argon2 cost for the server's password hashing, named by the host because the right value
/// depends on the plan it runs under.
#[wasm_bindgen]
pub struct ArgonCost {
    lanes: u32,
    mem_cost_kib: u32,
    time_cost: u32,
}

#[wasm_bindgen]
impl ArgonCost {
    #[wasm_bindgen(constructor)]
    pub fn new(lanes: u32, mem_cost_kib: u32, time_cost: u32) -> Self {
        Self {
            lanes,
            mem_cost_kib,
            time_cost,
        }
    }
}

/// A random identifier held in a Rust global, fixed at first call. Two objects reporting the same
/// value share one wasm instance — and so every other Rust global too.
#[wasm_bindgen]
pub fn instance_id() -> String {
    static ID: OnceLock<String> = OnceLock::new();
    ID.get_or_init(|| format!("{:016x}", (js_sys::Math::random() * 2f64.powi(53)) as u64))
        .clone()
}

#[wasm_bindgen]
pub struct TenantServer {
    injector: WasmConnectionInjector,
    accepted: Cell<u32>,
}

#[wasm_bindgen]
impl TenantServer {
    /// Start the node. `config_toml` is a `kernel.toml`; `storage` is the object's SQLite storage
    /// (see `storage::TenantStorage`). `on_exit` is called with a description of how the node
    /// ended, which for a server that should run until eviction is always a failure.
    #[wasm_bindgen(constructor)]
    pub fn start(
        config_toml: &str,
        storage: storage::TenantStorage,
        argon: ArgonCost,
        log_filter: &str,
        on_exit: js_sys::Function,
    ) -> Result<TenantServer, JsError> {
        tenant_console_log::init(log_filter);
        let config: ServerConfig = toml::from_str(config_toml)
            .map_err(|e| JsError::new(&format!("invalid kernel config: {e}")))?;
        let argon = ArgonDefaultServerSettings {
            lanes: argon.lanes,
            mem_cost: argon.mem_cost_kib,
            time_cost: argon.time_cost,
            ..ArgonDefaultServerSettings::default()
        };
        let backend = BackendType::HostSql(storage::backend_handle(storage));
        let (injector, listener) = WasmListener::injected();
        wasm_bindgen_futures::spawn_local(async move {
            let outcome = run_server_on::<WasmIO>(config, listener, backend, argon).await;
            let _ = on_exit.call1(&JsValue::NULL, &format!("{outcome:?}").into());
        });
        Ok(Self {
            injector,
            accepted: Cell::new(0),
        })
    }

    /// Hand the node a WebSocket the Durable Object has already `accept()`ed.
    pub fn accept(&self, ws: web_sys::WebSocket) -> Result<(), JsError> {
        let stream = WasmWebSocketStream::from_accepted(ws)
            .map_err(|e| JsError::new(&format!("cannot wrap socket: {e}")))?;
        self.injector
            .inject(WasmStream::WebSocket(stream), self.next_peer_addr())
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// A Worker sees no client socket address, but the node keys inbound sessions by one, so each
    /// connection gets its own from the shared-address block (100.64.0.0/10), which nothing routes.
    fn next_peer_addr(&self) -> SocketAddr {
        let n = self.accepted.get().wrapping_add(1);
        self.accepted.set(n);
        let [_, b, c, d] = n.to_be_bytes();
        SocketAddr::from((Ipv4Addr::new(100, 64 | (b & 0x3f), c, d), 1))
    }
}
