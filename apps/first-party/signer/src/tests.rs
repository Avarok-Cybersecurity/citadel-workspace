use super::*;
use citadel_app_signature::verify;

const MANIFEST: &str = include_str!("../../compute-pool/manifest.json");
const WASM: &[u8] = include_bytes!("../../compute-pool/wasm/compute-pool.wasm");

/// A fixed seed for these tests only, which signs nothing anyone installs. Real signing reads a
/// fresh seed from the environment.
fn key() -> AppSigningKey {
    AppSigningKey::from_seed(&[7u8; 32])
}

#[test]
fn the_committed_app_signs_and_the_signature_verifies_under_the_signers_key() {
    let signed = sign(MANIFEST, WASM, &key()).unwrap();
    let m: Value = serde_json::from_slice(&signed.manifest).unwrap();
    let public = key().public_key_hex();
    assert_eq!(m["publisher"]["mldsa65_public_key"], public.as_str());
    let digests = ArtifactDigests::of(&signed.manifest, WASM);
    verify(
        &public,
        "net.avarok.compute-pool",
        "0.1.0",
        &digests,
        &signed.signature,
    )
    .unwrap();
    let mut other = signed.manifest.clone();
    other.pop();
    let moved = ArtifactDigests::of(&other, WASM);
    assert!(verify(
        &public,
        "net.avarok.compute-pool",
        "0.1.0",
        &moved,
        &signed.signature
    )
    .is_err());
}

#[test]
fn a_module_that_is_not_the_manifests_is_refused() {
    let mut wasm = WASM.to_vec();
    *wasm.last_mut().unwrap() ^= 1;
    assert!(sign(MANIFEST, &wasm, &key())
        .unwrap_err()
        .contains("not the one"));
}

#[test]
fn a_manifest_that_does_not_declare_what_the_module_imports_is_refused() {
    let mut m: Value = serde_json::from_str(MANIFEST).unwrap();
    let caps = m["capabilities"].as_array_mut().unwrap();
    caps.retain(|c| !c["cap"].as_str().unwrap().starts_with("group.topic."));
    let why = sign(&m.to_string(), WASM, &key()).unwrap_err();
    assert!(why.contains("ABI inspector"), "{why}");
}
