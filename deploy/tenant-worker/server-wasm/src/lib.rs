//! The workspace server, compiled for a Durable Object.
//!
//! JS owns the sockets: the Durable Object accepts each WebSocket upgrade and hands the server
//! half here. Rust owns everything else — the Citadel node, the workspace kernel, the sessions —
//! running on the isolate's event loop for as long as the object lives. Its accounts and
//! workspace data live in the object's own SQLite storage (`storage`), so they outlive it.

mod admin;
mod auth_versions;
mod host_promise;
mod ice;
mod links;
mod sign_in;
mod storage;
mod support;
mod telemetry;
mod traffic;

use citadel_sdk::prelude::{
    ArgonDefaultServerSettings, BackendType, StunServers, WasmConnectionInjector, WasmIO,
    WasmListener, WasmStream, WasmWebSocketStream,
};
use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::sign_in::HostedSignIn;
use citadel_workspace_server_kernel::kernel::telemetry::HostedTelemetry;
use citadel_workspace_server_kernel::network::HostedNetwork;
use citadel_workspace_server_kernel::path_policy::PathPolicyConfig;
use citadel_workspace_server_kernel::run_server_on;
use std::cell::Cell;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::OnceLock;
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
    kernel: telemetry::KernelSlot,
}

#[wasm_bindgen]
impl TenantServer {
    /// Start the node. `config_toml` is a `kernel.toml`; `storage` is the object's SQLite storage
    /// (see `storage::TenantStorage`); `ice` mints relay credentials for `GetIceServers` (see
    /// `ice::IceHost`); `pq` is post-quantum sign-in and `sign_in` the object's sign-in settings
    /// (see `sign_in`). `support_grants` mirrors the support grant (see `support`). `links`
    /// gives the secure-link limits (see `links`). `stun_servers` is the host's comma-separated
    /// STUN list, required (`citadel_workspace_server_kernel::network`). `path_policy_json` is
    /// the tenant plan's path policy (control/path-policy.mjs), required, in the shape of
    /// kernel.toml's `[path_policy]` (`citadel_workspace_server_kernel::path_policy`). `on_exit`
    /// is called with a description of how the node ended, which for a server that should run
    /// until eviction is always a failure.
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(constructor)]
    pub fn start(
        config_toml: &str,
        storage: storage::TenantStorage,
        argon: ArgonCost,
        ice: ice::IceHost,
        pq: sign_in::PqSignIn,
        sign_in: sign_in::SignInHost,
        support_grants: support::SupportGrantHost,
        links: links::LinkQuotaHost,
        stun_servers: &str,
        path_policy_json: &str,
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
        // The host's STUN list (wrangler.toml STUN_SERVERS) and the plan's path policy, read
        // once at start: both required, with no default.
        let path_policy: PathPolicyConfig = serde_json::from_str(path_policy_json)
            .map_err(|e| JsError::new(&format!("invalid path policy: {e}")))?;
        let network = HostedNetwork {
            stun_servers: stun_servers
                .parse::<StunServers>()
                .map_err(|e| JsError::new(&format!("invalid STUN_SERVERS: {e}")))?,
            path_policy: path_policy
                .policy()
                .map_err(|e| JsError::new(&format!("invalid path policy: {e:?}")))?,
        };
        let backend = BackendType::HostSql(storage::backend_handle(storage));
        let ice_servers = Some(ice::source(ice));
        let link_quota = Some(links::source(links));
        let (settings, admission) = sign_in::host_capabilities(sign_in);
        let sign_in = HostedSignIn {
            pq_sign_in: Some(pq.into_settings()),
            admission: Some(admission),
            settings: Some(settings),
        };
        let kernel = telemetry::KernelSlot::default();
        let slot = kernel.clone();
        let telemetry = HostedTelemetry {
            support_grants: Some(support::observer(support_grants)),
            kernel_ready: Box::new(move |built| *slot.borrow_mut() = Some(built)),
        };
        let (injector, listener) = WasmListener::injected();
        wasm_bindgen_futures::spawn_local(async move {
            let outcome = run_server_on::<WasmIO>(
                config,
                listener,
                backend,
                argon,
                ice_servers,
                sign_in,
                telemetry,
                link_quota,
                None,
                // Server egress for apps: none yet. A Worker's `fetch` resolves names itself and
                // cannot be pinned to the addresses the policy checked, so an `EgressFetcher`
                // here needs a resolve-then-connect primitive the runtime does not offer; until
                // then `net.server` calls are answered unavailable (kernel::apps::egress).
                None,
                network,
            )
            .await;
            let _ = on_exit.call1(&JsValue::NULL, &format!("{outcome:?}").into());
        });
        Ok(Self {
            injector,
            accepted: Cell::new(0),
            kernel,
        })
    }

    /// Hand the node a WebSocket the Durable Object has already `accept()`ed. Returns the IP the
    /// node knows the connection by (unique per connection), which the object maps to the
    /// client's real one: the admission check is told that IP.
    pub fn accept(&self, ws: web_sys::WebSocket) -> Result<String, JsError> {
        let stream = WasmWebSocketStream::from_accepted(ws)
            .map_err(|e| JsError::new(&format!("cannot wrap socket: {e}")))?;
        let peer = self.next_peer_addr();
        self.injector
            .inject(WasmStream::WebSocket(stream), peer)
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(peer.ip().to_string())
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
