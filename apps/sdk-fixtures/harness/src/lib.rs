//! The fixtures' contract (`fixtures.json`) and a reference host for running them.

pub mod host;
mod respond;
mod state;

use citadel_app_sdk_types::Capability;
use serde_json::Value;
use std::path::PathBuf;

pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// fixtures.json, parsed.
pub fn manifest() -> Value {
    let path = fixtures_dir().join("fixtures.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).expect("fixtures.json is JSON")
}

/// The committed build of `name`. Missing means the build script was not run: fail, never skip.
pub fn wasm(name: &str) -> Vec<u8> {
    let path = fixtures_dir().join("wasm").join(format!("{name}.wasm"));
    std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "{}: {e}. Run `node scripts/build-app-fixtures.mjs`.",
            path.display()
        )
    })
}

pub fn caps(list: &Value) -> Vec<Capability> {
    list.as_array()
        .expect("a capability list")
        .iter()
        .map(|c| {
            let name = c.as_str().expect("a capability name");
            Capability::from_name(name).unwrap_or_else(|| panic!("unknown capability {name}"))
        })
        .collect()
}

/// The context every run starts with. The values are arbitrary but fixed; only `granted`
/// matters to a fixture, and the host's checks never read the context.
pub fn context(granted: &[Capability]) -> citadel_app_sdk_types::AppContext {
    use citadel_app_sdk_types::{AppContext, AppScope, Size, Surface};
    AppContext {
        app_id: "net.avarok.fixture".into(),
        install_id: "install-1".into(),
        scope: AppScope::Workspace,
        granted: granted.to_vec(),
        surface: Surface::CanvasPane,
        size: Size {
            width: 320,
            height: 200,
        },
        dpr: 1.0,
        theme: Default::default(),
        locale: "en".into(),
        acting_username: "alice".into(),
        node_id: "root".into(),
    }
}
