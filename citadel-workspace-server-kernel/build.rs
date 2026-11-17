//! Embeds the first-party releases this server provisions every workspace with
//! (`kernel::apps::first_party_bundles`).
//!
//! `CITADEL_FIRST_PARTY_SIGNED_DIR` names the directory `scripts/build-first-party-apps.mjs --sign`
//! wrote: one subdirectory per app, each holding `manifest.json` and `app.mldsa.sig`. The deploy
//! sets it, and refuses to build without it; any other build (a developer's, PR CI's) has no
//! signing key, so it embeds no release and provisions no first-party app. A directory that is set
//! but incomplete fails the build: a half-signed release is not something to ship quietly.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

const DIR_ENV: &str = "CITADEL_FIRST_PARTY_SIGNED_DIR";
const MANIFEST: &str = "manifest.json";
const SIGNATURE: &str = "app.mldsa.sig";

fn bundles(dir: &Path) -> Vec<(String, PathBuf, PathBuf)> {
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
            (name, manifest, signature)
        })
        .collect()
}

fn main() {
    println!("cargo:rerun-if-env-changed={DIR_ENV}");
    let mut code = String::from("&[\n");
    if let Some(dir) = std::env::var_os(DIR_ENV) {
        let dir = PathBuf::from(dir);
        println!("cargo:rerun-if-changed={}", dir.display());
        for (name, manifest, signature) in bundles(&dir) {
            writeln!(
                code,
                "    ({name:?}, SignedBundle {{ manifest: include_bytes!({:?}), signature: include_str!({:?}) }}),",
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
