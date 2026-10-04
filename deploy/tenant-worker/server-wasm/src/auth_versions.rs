//! The census of stored accounts by auth-record version (the `tenant-auth-versions` crate), for
//! the Durable Object to call with the rows it selected. Bytes in, counts out: the object does
//! the SELECT (see control/auth-versions.mjs).

use js_sys::{Array, ArrayBuffer, Object, Reflect, Uint8Array};
use tenant_auth_versions::count;
use wasm_bindgen::prelude::*;

/// `{ legacy_argon, transient, post_quantum, undecodable }` over `blobs`, each an `ArrayBuffer` or
/// typed array (what `sql.exec(..).raw()` gives a BLOB column). A value that is neither is a row
/// that cannot be read, and counts as undecodable.
#[wasm_bindgen]
pub fn count_auth_versions(blobs: Array) -> Result<Object, JsError> {
    let bytes: Vec<Vec<u8>> = blobs
        .iter()
        .map(|value| {
            if value.is_instance_of::<ArrayBuffer>() || ArrayBuffer::is_view(&value) {
                Uint8Array::new(&value).to_vec()
            } else {
                Vec::new()
            }
        })
        .collect();
    let counts = count(bytes.iter().map(Vec::as_slice));
    let out = Object::new();
    for (name, n) in [
        ("legacy_argon", counts.legacy_argon),
        ("transient", counts.transient),
        ("post_quantum", counts.post_quantum),
        ("undecodable", counts.undecodable),
    ] {
        Reflect::set(&out, &name.into(), &n.into())
            .map_err(|_| JsError::new("cannot build the census"))?;
    }
    Ok(out)
}
