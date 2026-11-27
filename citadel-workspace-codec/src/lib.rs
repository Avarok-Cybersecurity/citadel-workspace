//! The workspace protocol codec the page uses: its JSON wire (serde_json, as the server kernel
//! reads and writes it) to and from JS values, through `citadel_workspace_types`' own serde types.
//!
//! - A decode is checked: bytes that are not a `WorkspaceProtocolPayload` are refused here,
//!   instead of being cast to the TypeScript type and failing wherever a field is first read.
//! - Which fields are u64 comes from the types: each one reaches the page as an exact BigInt,
//!   with no list of field names to keep in step with them.
//! - Byte fields (`wire_bytes`) reach the page as `Uint8Array` and are taken from one, while the
//!   JSON keeps writing them as arrays of numbers.
//!
//! Pure: no I/O. Errors name where the input broke, never a value from it (a payload carries
//! messages and documents).

use citadel_workspace_types::WorkspaceProtocolPayload;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[cfg(test)]
mod tests;

/// The JSON bytes, read into the protocol's types.
pub fn read(json: &[u8]) -> Result<WorkspaceProtocolPayload, String> {
    serde_json::from_slice(json).map_err(|err| {
        format!(
            "not a workspace payload: {:?} error at line {} column {}",
            err.classify(),
            err.line(),
            err.column()
        )
    })
}

/// The protocol's JSON bytes for a payload.
pub fn write(payload: &WorkspaceProtocolPayload) -> Result<Vec<u8>, String> {
    serde_json::to_vec(payload)
        .map_err(|err| format!("unwritable workspace payload: {:?}", err.classify()))
}

/// The page's shapes: maps as plain objects and `None` as `null`, as `JSON.parse` gave them, so
/// a consumer reads the same values; every u64 as a BigInt, as the generated types declare it.
fn page_shape() -> serde_wasm_bindgen::Serializer {
    serde_wasm_bindgen::Serializer::new()
        .serialize_large_number_types_as_bigints(true)
        .serialize_maps_as_objects(true)
        .serialize_missing_as_null(true)
}

/// A `WorkspaceProtocolPayload` the page built, as the JSON bytes the kernel reads.
#[wasm_bindgen]
pub fn encode_workspace_payload(payload: JsValue) -> Result<Vec<u8>, JsError> {
    let payload: WorkspaceProtocolPayload =
        serde_wasm_bindgen::from_value(payload).map_err(|_| {
            JsError::new("not a workspace payload: it does not match the protocol's types")
        })?;
    write(&payload).map_err(|err| JsError::new(&err))
}

/// Workspace protocol JSON bytes as a checked `WorkspaceProtocolPayload` for the page.
#[wasm_bindgen]
pub fn decode_workspace_payload(json: &[u8]) -> Result<JsValue, JsError> {
    let payload = read(json).map_err(|err| JsError::new(&err))?;
    payload
        .serialize(&page_shape())
        .map_err(|_| JsError::new("workspace payload could not be handed to the page"))
}
