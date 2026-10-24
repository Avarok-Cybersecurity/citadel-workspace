//! The node's own traffic by class, for the object's meter (control/meter.mjs): how much of what
//! crosses the object is P2P traffic the server relays, and how much is group fan-out, apart from
//! the client-server traffic it serves. Counts are the protocol's (Citadel packet bytes, not
//! WebSocket framing), monotonic from the node's start.

use crate::TenantServer;
use js_sys::{Object, Reflect};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl TenantServer {
    /// `{relayed_p2p_rx, relayed_p2p_tx, group_broadcast_rx, group_broadcast_tx,
    /// client_server_rx, client_server_tx}` since the node started, or null before it has.
    pub fn traffic(&self) -> Result<JsValue, JsValue> {
        let Some(remote) = self.kernel().and_then(|k| k.node_remote.read().clone()) else {
            return Ok(JsValue::NULL);
        };
        let t = remote.traffic();
        let out = Object::new();
        for (key, value) in [
            ("relayed_p2p_rx", t.relayed_p2p.rx),
            ("relayed_p2p_tx", t.relayed_p2p.tx),
            ("group_broadcast_rx", t.group_broadcast.rx),
            ("group_broadcast_tx", t.group_broadcast.tx),
            ("client_server_rx", t.client_server.rx),
            ("client_server_tx", t.client_server.tx),
        ] {
            // Exact below 2^53 bytes (9 PB): a node's lifetime is far shorter.
            Reflect::set(&out, &key.into(), &JsValue::from_f64(value as f64))?;
        }
        Ok(out.into())
    }
}
