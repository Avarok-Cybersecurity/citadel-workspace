//! Every first-party app's committed manifest (apps/first-party/<app>/manifest.json) is one the
//! kernel parses, and the Calendar's is what provisioning installs it as (Calendar design §3.2):
//! the glue ABI, a node tab, installed once for the whole workspace.

use citadel_workspace_types::apps::ScopeKind;
use citadel_workspace_types::apps_manifest::{AppManifest, AppSurface, ABI_FIRST_PARTY_GLUE};
use std::path::{Path, PathBuf};

fn first_party_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../apps/first-party")
}

fn manifest(app: &str) -> AppManifest {
    let path = first_party_dir().join(app).join("manifest.json");
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    AppManifest::from_bytes(&bytes).unwrap_or_else(|why| panic!("{app}: {why}"))
}

#[test]
fn every_committed_first_party_manifest_parses() {
    let mut apps: Vec<String> = std::fs::read_dir(first_party_dir())
        .expect("apps/first-party")
        .filter_map(Result::ok)
        .filter(|e| e.path().join("manifest.json").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    apps.sort();
    assert_eq!(apps, ["calendar", "compute-pool", "synchronized-work"]);
    for app in &apps {
        manifest(app);
    }
}

#[test]
fn the_calendar_is_a_glue_app_tab_installed_for_the_workspace() {
    let calendar = manifest("calendar");
    assert_eq!(calendar.id, "net.avarok.calendar");
    assert_eq!(calendar.sdk.abi, ABI_FIRST_PARTY_GLUE);
    assert_eq!(calendar.surfaces, [AppSurface::NodeTab]);
    assert_eq!(calendar.scopes, [ScopeKind::Workspace]);
}
