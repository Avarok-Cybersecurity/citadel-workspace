//! Every first-party app's committed manifest (apps/first-party/<app>/manifest.json) is a valid
//! manifest as it stands: the signer only sets the publisher key, so what it signs is what this
//! reads.

use citadel_workspace_types::apps_manifest::AppManifest;
use std::path::Path;

#[test]
fn every_first_party_manifest_reads() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../apps/first-party");
    let mut read = 0;
    for entry in std::fs::read_dir(&dir).expect("apps/first-party") {
        let path = entry.unwrap().path().join("manifest.json");
        if !path.exists() {
            continue;
        }
        let bytes = std::fs::read(&path).unwrap();
        AppManifest::from_bytes(&bytes).unwrap_or_else(|why| panic!("{}: {why}", path.display()));
        read += 1;
    }
    assert!(read >= 1, "no first-party manifest under {}", dir.display());
}
