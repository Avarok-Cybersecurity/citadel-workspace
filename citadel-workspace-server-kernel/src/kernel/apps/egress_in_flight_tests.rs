//! An egress answer for an install that ended while its request was out is withheld: removed
//! mid-request, the call answers `{unavailable: "install_ended"}`, never the response, so nothing
//! of a removed install reaches the session that ran it (or whatever replaced it).

use super::egress::ServerEgress;
use super::egress_port::{EgressAnswer, EgressFailure, EgressFetcher, PinnedRequest};
use super::egress_tests::{answer, RecordingHost};
use super::kernel_call_tests::fetch;
use super::test_manifests::*;
use super::test_runtime::*;
use citadel_app_sdk_types::calls::HttpResponse;
use citadel_app_sdk_types::{HostReply, Refused};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

/// The recording host, holding every exchange until the test releases it.
#[derive(Default)]
struct HeldHost {
    inner: RecordingHost,
    started: Notify,
    release: Notify,
}

#[async_trait::async_trait]
impl EgressFetcher for HeldHost {
    async fn resolve(&self, host: &str, port: u16) -> Result<Vec<IpAddr>, String> {
        self.inner.resolve(host, port).await
    }

    async fn exchange(
        &self,
        request: PinnedRequest,
        max_body: u64,
        timeout_ms: u64,
    ) -> Result<EgressAnswer, EgressFailure> {
        self.started.notify_one();
        self.release.notified().await;
        self.inner.exchange(request, max_body, timeout_ms).await
    }
}

async fn fetching_while(uninstall: bool) -> (HostReply<HttpResponse>, usize) {
    let mut kernel = workspace_serving(wasm(1, 4096)).await;
    let mut host = HeldHost::default();
    host.inner
        .names
        .insert(API_HOST.into(), vec!["93.184.216.34".parse().expect("ip")]);
    host.inner.answers.insert(
        "https://api.acme.example:443/v1".into(),
        answer(200, None, b"ok"),
    );
    let host = Arc::new(host);
    let deployment = citadel_app_net_policy::Deployment {
        page_origin_host: "acme.work.example".to_string(),
    };
    kernel.set_server_egress(Some(Arc::new(ServerEgress::new(host.clone(), deployment))));
    let id = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::NetServer],
    )
    .await;
    let fetching = async {
        let reply: HostReply<HttpResponse> = call(&kernel, "alice", &id, &fetch()).await;
        reply
    };
    let meanwhile = async {
        host.started.notified().await;
        if uninstall {
            let request = AppsRequest::Uninstall {
                install_id: id.clone(),
                purge_storage: false,
            };
            let removed = ask_on(&kernel, "boss", None, request).await;
            assert!(
                matches!(removed, AppsResponse::Uninstalled { .. }),
                "{removed:?}"
            );
        }
        host.release.notify_one();
    };
    let both = async { tokio::join!(fetching, meanwhile).0 };
    let reply = tokio::time::timeout(Duration::from_secs(10), both)
        .await
        .expect("the uninstall waited on the request it ends");
    let exchanged = host.inner.exchanged.lock().len();
    (reply, exchanged)
}

#[tokio::test]
async fn an_answer_for_an_install_removed_mid_request_is_withheld() {
    let (reply, exchanged) = fetching_while(true).await;
    assert_eq!(
        reply,
        HostReply::Refused(Refused::Unavailable("install_ended".into()))
    );
    assert_eq!(exchanged, 1, "the request did go out");
}

#[tokio::test]
async fn control_the_same_request_with_the_install_kept_is_answered() {
    let (reply, _) = fetching_while(false).await;
    assert_eq!(reply.into_result().expect("fetched").body.0, b"ok");
}
