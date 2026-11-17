//! The tenant's server identity, as the Durable Object provides it: `[identity]` from the
//! tenant's kernel.toml and the 32-byte key seed the object keeps in its own storage (made at
//! provisioning, never here). Built by the kernel's `hosted_identity`, the check a native server
//! runs too, and handed to the node by [`crate::TenantServer`]; the object serves
//! [`ServerIdentityHost::well_known`] as `/.well-known/citadel`, the same artefact a
//! self-hosted server writes for its proxy.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::server_identity::{hosted_identity, ServerIdentity};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ServerIdentityHost(Arc<ServerIdentity>);

#[wasm_bindgen]
impl ServerIdentityHost {
    /// `config_toml` is the kernel.toml the node starts with; `server_key_seed` the 32 bytes the
    /// object keeps. The seed is copied in once and never leaves; nothing here prints it.
    #[wasm_bindgen(constructor)]
    pub fn new(config_toml: &str, server_key_seed: &[u8]) -> Result<ServerIdentityHost, JsError> {
        let config: ServerConfig = toml::from_str(config_toml)
            .map_err(|e| JsError::new(&format!("invalid kernel config: {e}")))?;
        let seed: &[u8; 32] = server_key_seed
            .try_into()
            .map_err(|_| JsError::new("the server key seed is not 32 bytes"))?;
        hosted_identity(config.identity.as_ref(), seed)
            .map(|identity| Self(Arc::new(identity)))
            .map_err(|e| JsError::new(&e))
    }

    /// The `/.well-known/citadel` JSON, issued at `issued_at_s` (Unix seconds).
    pub fn well_known(&self, issued_at_s: u64) -> Result<Vec<u8>, JsError> {
        self.0
            .well_known_document(issued_at_s)
            .map_err(|e| JsError::new(&e))
    }
}

impl ServerIdentityHost {
    pub fn shared(&self) -> Arc<ServerIdentity> {
        self.0.clone()
    }
}
