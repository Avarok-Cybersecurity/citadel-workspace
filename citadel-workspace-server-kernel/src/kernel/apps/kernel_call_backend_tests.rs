//! `Call` through the kernel: blobs, server egress, and what the server leaves to others.

use super::kernel_call_tests::{blob_put, fetch, get};
use super::test_manifests::*;
use super::test_runtime::*;
use citadel_app_sdk_types::calls::*;
use citadel_app_sdk_types::ops::StorageOps;
use citadel_app_sdk_types::{HostCall, HostReply, Refused};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_responses::AppsResponse;

#[tokio::test]
async fn blobs_round_trip_by_digest() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::StorageBlob],
    )
    .await;
    let bytes: Vec<u8> = (0..300_000u32).map(|i| i as u8).collect();
    let put: HostReply<BlobRef> = call(&kernel, "alice", &id, &blob_put(&bytes)).await;
    let sha256 = put.into_result().expect("stored").sha256;
    let get_blob = HostCall::Storage(StorageOps::BlobGet(BlobGet {
        sha256: sha256.clone(),
    }));
    let got: HostReply<BytesValue> = call(&kernel, "bob", &id, &get_blob).await;
    assert_eq!(got.into_result().expect("read").bytes.0, bytes);
    let delete = HostCall::Storage(StorageOps::BlobDelete(BlobDelete { sha256 }));
    // Deleting takes EditContent on the install's node, which a Member does not hold.
    let refused: HostReply<()> = call(&kernel, "alice", &id, &delete).await;
    assert_eq!(
        refused,
        HostReply::Refused(Refused::Policy("permission".into()))
    );
    let kept: HostReply<BytesValue> = call(&kernel, "bob", &id, &get_blob).await;
    assert_eq!(kept.into_result().expect("still there").bytes.0, bytes);
    let deleted: HostReply<()> = call(&kernel, "boss", &id, &delete).await;
    assert_eq!(deleted, HostReply::Ok(()));
    let gone: HostReply<BytesValue> = call(&kernel, "bob", &id, &get_blob).await;
    assert_eq!(
        gone,
        HostReply::Refused(Refused::Unavailable("not_found".into()))
    );
}

#[tokio::test]
async fn what_the_server_does_not_serve_is_unavailable_once_granted() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let caps = [Capability::StorageLocal, Capability::NetServer];
    let id = install(&kernel, "boss", InstallScope::Workspace, &caps).await;
    let local: HostReply<()> = call(&kernel, "alice", &id, &get(KvBackend::Local, "k")).await;
    assert_eq!(
        local,
        HostReply::Refused(Refused::Unavailable("host_local".into()))
    );
    let net: HostReply<()> = call(&kernel, "alice", &id, &fetch()).await;
    assert_eq!(
        net,
        HostReply::Refused(Refused::Unavailable("server_egress".into()))
    );
    let request = citadel_workspace_types::apps_protocol::AppsRequest::Call {
        install_id: id,
        call: b"not cbor".to_vec(),
    };
    let AppsResponse::CallReply { reply } = ask_on(&kernel, "alice", None, request).await else {
        panic!("not a reply");
    };
    let reply: HostReply<()> = citadel_app_sdk_types::decode(&reply).expect("reply");
    assert_eq!(
        reply,
        HostReply::Refused(Refused::Policy("bad_arguments".into()))
    );
}

#[tokio::test]
async fn a_server_fetch_goes_out_through_the_host_s_egress() {
    use super::egress_tests::{answer, RecordingHost};
    let mut kernel = workspace_serving(wasm(1, 4096)).await;
    let mut host = RecordingHost::default();
    host.names
        .insert(API_HOST.into(), vec!["93.184.216.34".parse().expect("ip")]);
    host.answers.insert(
        "https://api.acme.example:443/v1".into(),
        answer(200, None, b"ok"),
    );
    let host = std::sync::Arc::new(host);
    let deployment = citadel_app_net_policy::Deployment {
        page_origin_host: "acme.work.example".to_string(),
    };
    let egress = super::egress::ServerEgress::new(host.clone(), deployment);
    kernel.set_server_egress(Some(std::sync::Arc::new(egress)));
    let id = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::NetServer],
    )
    .await;
    let reply: HostReply<HttpResponse> = call(&kernel, "alice", &id, &fetch()).await;
    assert_eq!(reply.into_result().expect("fetched").body.0, b"ok");
    assert_eq!(host.exchanged.lock().len(), 1);
    let ungranted = install(&kernel, "boss", InstallScope::SelfOnly("bob".into()), &[]).await;
    let refused: HostReply<HttpResponse> = call(&kernel, "bob", &ungranted, &fetch()).await;
    assert_eq!(refused, HostReply::Refused(Refused::Ungranted));
    assert_eq!(
        host.exchanged.lock().len(),
        1,
        "an ungranted call never reaches the host"
    );
}

#[tokio::test]
async fn an_install_that_does_not_reach_the_caller_is_unavailable_to_them() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let scope = InstallScope::SelfOnly("bob".into());
    let id = install(&kernel, "boss", scope, &[Capability::StorageUser]).await;
    let answer = call_raw(&kernel, "alice", &id, &get(KvBackend::User, "k")).await;
    let unavailable = citadel_workspace_types::apps_install::AppsRefusal::Unavailable;
    assert_eq!(answer, AppsResponse::Refused(unavailable));
    let bob: HostReply<KvValue> = call(&kernel, "bob", &id, &get(KvBackend::User, "k")).await;
    assert!(matches!(bob, HostReply::Ok(_)));
}
