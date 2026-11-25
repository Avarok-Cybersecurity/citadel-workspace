//! Embeds the first-party releases this server provisions every workspace with
//! (`kernel::apps::first_party_bundles`).
//!
//! `CITADEL_FIRST_PARTY_SIGNED_DIR` names the directory `scripts/build-first-party-apps.mjs --sign`
//! wrote: one subdirectory per app, each holding `manifest.json` and `app.mldsa.sig`. The deploy
//! sets it, and refuses to build without it; any other build (a developer's, PR CI's) has no
//! signing key, so it embeds no release and provisions no first-party app. A directory that is set
//! but incomplete fails the build: a half-signed release is not something to ship quietly.
//!
//! An app whose module the server stores (any ABI but the glue one) also holds `module.wasm`,
//! which the signer writes exactly then. Whether one is required is the manifest's ABI to say,
//! which this does not parse: the signer always writes it for such an app, and provisioning
//! refuses such a release without it (`apps::first_party`), so a dir lacking it fails the deploy.
//!
//! The `ci-first-party-root` feature (`kernel::apps::ci_first_party_root`) is refused here for any
//! build that could ship: one with `CITADEL_DEPLOY` set (the deploy sets it, to any value) and any
//! wasm32 build (the hosted server's target).

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

const DIR_ENV: &str = "CITADEL_FIRST_PARTY_SIGNED_DIR";
const MANIFEST: &str = "manifest.json";
const SIGNATURE: &str = "app.mldsa.sig";
const MODULE: &str = "module.wasm";
const DEPLOY_ENV: &str = "CITADEL_DEPLOY";
const CI_ROOT_FEATURE_ENV: &str = "CARGO_FEATURE_CI_FIRST_PARTY_ROOT";

/// Why this build may not have the CI first-party root, if it has it and is one that could ship.
fn ci_root_refusal() -> Option<String> {
    std::env::var_os(CI_ROOT_FEATURE_ENV)?;
    if let Some(deploy) = std::env::var_os(DEPLOY_ENV) {
        return Some(format!(
            "the ci-first-party-root feature is for the integration image only, and {DEPLOY_ENV}={} marks a deploy",
            deploy.to_string_lossy()
        ));
    }
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").expect("CARGO_CFG_TARGET_ARCH");
    (arch == "wasm32").then(|| {
        "the ci-first-party-root feature is for the integration image only, and wasm32 is the hosted server's target".to_string()
    })
}

fn bundles(dir: &Path) -> Vec<(String, PathBuf, PathBuf, Option<PathBuf>)> {
    let mut apps: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{DIR_ENV}={}: {e}", dir.display()))
        .map(|entry| entry.expect("a directory entry").path())
        .filter(|path| path.is_dir())
        .collect();
    apps.sort();
    assert!(
        !apps.is_empty(),
        "{DIR_ENV}={} holds no signed app",
        dir.display()
    );
    apps.into_iter()
        .map(|app| {
            let name = app
                .file_name()
                .expect("a name")
                .to_string_lossy()
                .into_owned();
            let (manifest, signature) = (app.join(MANIFEST), app.join(SIGNATURE));
            for file in [&manifest, &signature] {
                assert!(file.is_file(), "{} is missing", file.display());
                println!("cargo:rerun-if-changed={}", file.display());
            }
            let module = app.join(MODULE);
            println!("cargo:rerun-if-changed={}", module.display());
            (
                name,
                manifest,
                signature,
                module.is_file().then_some(module),
            )
        })
        .collect()
}

fn main() {
    println!("cargo:rerun-if-env-changed={DIR_ENV}");
    println!("cargo:rerun-if-env-changed={DEPLOY_ENV}");
    if let Some(why) = ci_root_refusal() {
        panic!("{why}");
    }
    let mut code = String::from("&[\n");
    if let Some(dir) = std::env::var_os(DIR_ENV) {
        let dir = PathBuf::from(dir);
        println!("cargo:rerun-if-changed={}", dir.display());
        for (name, manifest, signature, module) in bundles(&dir) {
            let module = match module {
                Some(path) => format!("Some(include_bytes!({:?}))", path.display().to_string()),
                None => "None".to_string(),
            };
            writeln!(
                code,
                "    ({name:?}, SignedBundle {{ manifest: include_bytes!({:?}), signature: include_str!({:?}), module: {module} }}),",
                manifest.display().to_string(),
                signature.display().to_string(),
            )
            .expect("formatting");
        }
    }
    code.push(']');
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"));
    std::fs::write(out.join("first_party_bundles.rs"), code).expect("write the embedded list");
}
