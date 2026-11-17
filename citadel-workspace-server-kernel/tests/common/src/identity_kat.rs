//! The frozen batch-1116 identity contract's known answers and fixtures
//! (`docs/contracts/batch-1116/`), read from the contract itself so a test can never drift from
//! it. Every seed there is a published test seed; none is, or may become, a production key.

use citadel_workspace_server_kernel::kernel::server_identity::config::{Discovery, IdentityConfig};
use serde_json::Value;
use std::path::PathBuf;

pub fn contract_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../docs/contracts/batch-1116")
}

pub fn read_json(relative: &str) -> Value {
    let path = contract_dir().join(relative);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path:?}: {e}"))
}

pub fn kat() -> Value {
    read_json("identity-kat.json")
}

pub fn text<'a>(value: &'a Value, pointer: &str) -> &'a str {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("the KAT has no text at {pointer}"))
}

pub fn bytes(value: &Value, pointer: &str) -> Vec<u8> {
    hex::decode(text(value, pointer)).expect("hex")
}

pub fn seed(value: &Value, pointer: &str) -> [u8; 32] {
    bytes(value, pointer).try_into().expect("a 32-byte seed")
}

/// `/servers/<name>` in the KAT.
pub fn server(name: &str) -> Value {
    kat()
        .pointer(&format!("/servers/{}", name.replace('/', "~1")))
        .cloned()
        .unwrap_or_else(|| panic!("the KAT has no server {name}"))
}

/// The `[identity]` a well-known fixture describes: its canonical domain, former domains and
/// wss endpoint, as an operator would write them.
pub fn identity_config_of(document: &Value) -> IdentityConfig {
    IdentityConfig {
        canonical_domain: Some(text(document, "/canonical_domain").to_string()),
        former_domains: Some(
            document["former_domains"]
                .as_array()
                .expect("former_domains")
                .iter()
                .map(|d| d.as_str().expect("text").to_string())
                .collect(),
        ),
        discovery: Some(Discovery::WellKnown),
        citadel_wss: Some(text(document, "/citadel/wss").to_string()),
        server_key_file: None,
        well_known_file: None,
    }
}
