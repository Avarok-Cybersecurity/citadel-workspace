//! `AdvertiseService` names the route table it serves by `routes_digest`; the kernel takes it
//! only when it is the digest of the routes the installer consented to (the manifest's
//! `ihttp.serve` routes), in whatever order the app lists them.

use super::ihttp_routes::routes_digest;
use super::test_ihttp::*;
use super::test_manifests::*;
use super::test_runtime::*;
use citadel_workspace_types::apps::InstallScope;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_responses::AppsResponse;

#[test]
fn the_digest_is_of_the_sorted_lines_so_order_does_not_matter() {
    let digest = routes_digest(["POST /b/:id", "GET /a"]);
    assert_eq!(digest, routes_digest(["GET /a", "POST /b/:id"]));
    let text = "GET /a\nPOST /b/:id";
    assert_eq!(
        digest,
        hex::encode(citadel_app_signature::sha256(text.as_bytes()))
    );
    assert_ne!(digest, routes_digest(["GET /a"]));
}

#[tokio::test]
async fn an_advertisement_of_the_consented_routes_is_taken() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    let taken = advertise_digest(&kernel, "bob", Some(BOB), &id, &served_digest()).await;
    assert!(matches!(taken, AppsResponse::Advertised { .. }));
}

#[tokio::test]
async fn an_advertisement_of_other_routes_is_refused_and_serves_nothing() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    let other = routes_digest(["GET /cards", "DELETE /cards/:id"]);
    let refused = advertise_digest(&kernel, "bob", Some(BOB), &id, &other).await;
    assert_eq!(refusal(&refused), Some(&AppsRefusal::Policy));
    let none = send(
        &kernel,
        "alice",
        ALICE,
        &id,
        user("bob"),
        head(1, "workspace"),
    )
    .await;
    assert_eq!(refusal(&none), Some(&AppsRefusal::NoHost));
}
