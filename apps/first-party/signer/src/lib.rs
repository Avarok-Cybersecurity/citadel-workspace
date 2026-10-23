//! The signer's whole decision, pure: given the committed manifest text, the module and a
//! signing key, the manifest bytes to publish and their signature, or why not.

use citadel_app_abi_inspect::{check, Policy};
use citadel_app_sdk_types::Capability;
use citadel_app_signature::{sha256, AppSigningKey, ArtifactDigests};
use serde_json::Value;

/// What to install: the exact manifest bytes and the `app.mldsa.sig` text.
#[derive(Debug, PartialEq, Eq)]
pub struct Signed {
    pub manifest: Vec<u8>,
    pub signature: String,
}

fn field<'a>(m: &'a Value, path: &[&str]) -> Result<&'a Value, String> {
    path.iter()
        .try_fold(m, |v, p| v.get(p))
        .ok_or_else(|| format!("the manifest has no {}", path.join(".")))
}

fn text<'a>(m: &'a Value, path: &[&str]) -> Result<&'a str, String> {
    field(m, path)?.as_str().ok_or_else(|| format!("{} is not text", path.join(".")))
}

/// The declared capabilities, by name.
fn declared(m: &Value) -> Result<Vec<Capability>, String> {
    let caps = field(m, &["capabilities"])?.as_array().ok_or("capabilities is not a list")?;
    caps.iter()
        .map(|c| {
            let name = c.get("cap").and_then(Value::as_str).unwrap_or_default();
            Capability::from_name(name).ok_or_else(|| format!("unknown capability {name:?}"))
        })
        .collect()
}

pub fn sign(manifest_text: &str, wasm: &[u8], key: &AppSigningKey) -> Result<Signed, String> {
    let mut m: Value = serde_json::from_str(manifest_text).map_err(|e| e.to_string())?;
    let want = hex(&sha256(wasm));
    if text(&m, &["artifact", "sha256"])? != want {
        return Err("the module is not the one the manifest names: rebuild it".into());
    }
    if field(&m, &["artifact", "bytes"])?.as_u64() != Some(wasm.len() as u64) {
        return Err("the module's size is not the manifest's".into());
    }
    let pages = field(&m, &["limits", "memory_pages"])?.as_u64().ok_or("memory_pages")?;
    let policy = Policy {
        declared: declared(&m)?,
        max_memory_pages: u32::try_from(pages).map_err(|_| "memory_pages")?,
    };
    let verdict = check(wasm, &policy);
    if !verdict.is_accepted() {
        return Err(format!("the ABI inspector refuses the module: {:?}", verdict.reasons()));
    }
    m["publisher"]["mldsa65_public_key"] = Value::String(key.public_key_hex());
    let mut manifest = serde_json::to_vec_pretty(&m).map_err(|e| e.to_string())?;
    manifest.push(b'\n');
    let (id, version) = (text(&m, &["id"])?, text(&m, &["version"])?);
    let digests = ArtifactDigests::of(&manifest, wasm);
    let signature = key.sign(id, version, &digests).map_err(|e| e.to_string())?;
    Ok(Signed { manifest, signature })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests;
