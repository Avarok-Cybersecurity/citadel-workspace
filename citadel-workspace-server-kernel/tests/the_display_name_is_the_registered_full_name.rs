//! An account appears to other members under the full name it registered
//! with, not its username.
//!
//! The connect handler created the user record as `User::new(user_id, user_id,
//! ..)`, so someone who signed up as "Bob Brown" was listed, messaged and
//! requested as `bob0924` everywhere. Run end to end against the production
//! server: the full name exists only on the SDK's account record, so a kernel
//! with an injected user could not show whether it is read.

use citadel_sdk::prefabs::client::single_connection::SingleClientServerConnectionKernel;
use citadel_sdk::prefabs::client::ServerConnectionSettingsBuilder;
use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::User;
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use common::production_server::start_production_server;
use futures::StreamExt;
use std::net::SocketAddr;
use std::time::Duration;

const USERNAME: &str = "bob0924";
const FULL_NAME: &str = "Bob Brown";
const PASSWORD: &str = "password123";
const MUST_ANSWER_WITHIN: Duration = Duration::from_secs(60);

/// Sends `request` until a response `accept` takes, retrying on `Error`:
/// enrolment runs on its own task after ConnectSuccess, so the first ask can
/// land before the record exists.
async fn ask<R: Ratchet, T>(
    tx: &mut PeerChannelSendHalf<R>,
    rx: &mut PeerChannelRecvHalf<R>,
    request: WorkspaceProtocolRequest,
    accept: impl Fn(WorkspaceProtocolResponse) -> Option<T>,
) -> Result<T, NetworkError> {
    for _ in 0..50 {
        let payload = WorkspaceProtocolPayload::Request(request.clone());
        tx.send(serde_json::to_vec(&payload).expect("encode"))
            .await?;
        while let Some(bytes) = rx.next().await {
            let Ok(WorkspaceProtocolPayload::Response(response)) =
                serde_json::from_slice::<WorkspaceProtocolPayload>(bytes.as_ref())
            else {
                continue;
            };
            if matches!(*response, WorkspaceProtocolResponse::Error(_)) {
                break;
            }
            if let Some(found) = accept(*response) {
                return Ok(found);
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(NetworkError::msg("the server never gave the wanted answer"))
}

fn own_record() -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::GetMember {
        user_id: USERNAME.to_string(),
    }
}

fn member(response: WorkspaceProtocolResponse) -> Option<User> {
    match response {
        WorkspaceProtocolResponse::Member(user) => Some(user),
        _ => None,
    }
}

/// Connects with `settings` and returns the display name the server holds for
/// this account. With `repair`, it first renames the record to the username --
/// exactly the placeholder the old handler wrote -- then disconnects and logs
/// in again on the same node, and reads what that connect left behind.
async fn stored_name(settings: ServerConnectionSettings<StackedRatchet>, repair: bool) -> String {
    let (name_tx, name_rx) = tokio::sync::oneshot::channel::<String>();
    let name_tx = std::sync::Mutex::new(Some(name_tx));
    let kernel = SingleClientServerConnectionKernel::new(settings, move |mut conn| {
        let name_tx = name_tx.lock().unwrap().take();
        async move {
            let (mut tx, mut rx) = conn.take_channel().expect("channel").split();
            let mut user = ask(&mut tx, &mut rx, own_record(), member).await?;
            if repair {
                let rename = WorkspaceProtocolRequest::UpdateUserProfile {
                    name: Some(USERNAME.to_string()),
                    avatar_data: None,
                    email: None,
                    title: None,
                };
                let renamed = ask(&mut tx, &mut rx, rename, |r| match r {
                    WorkspaceProtocolResponse::UserProfileUpdated(u) => Some(u),
                    _ => None,
                })
                .await?;
                assert_eq!(renamed.name, USERNAME, "the placeholder was not set up");
                drop((tx, rx));
                let node = conn.remote.remote().clone();
                conn.disconnect().await?;
                let mut again = node
                    .connect_with_defaults(AuthenticationRequest::credentialed(USERNAME, PASSWORD))
                    .await?;
                let (mut tx, mut rx) = again.take_channel().expect("channel").split();
                user = ask(&mut tx, &mut rx, own_record(), member).await?;
            }
            if let Some(tx) = name_tx {
                let _ = tx.send(user.name);
            }
            Ok(())
        }
    });
    let mut builder = DefaultNodeBuilder::default();
    let client = builder
        .with_backend(BackendType::InMemory)
        .with_insecure_skip_cert_verification()
        .build(kernel)
        .expect("client node");
    let client = tokio::spawn(client);
    tokio::select! {
        Ok(name) = name_rx => name,
        done = client => panic!("the client ended first: {:?}", done.map(|r| r.err())),
        _ = tokio::time::sleep(MUST_ANSWER_WITHIN) => panic!("no answer within {MUST_ANSWER_WITHIN:?}"),
    }
}

fn registration(addr: SocketAddr) -> ServerConnectionSettings<StackedRatchet> {
    ServerConnectionSettingsBuilder::credentialed_registration(addr, USERNAME, FULL_NAME, PASSWORD)
        .with_udp_mode(UdpMode::Disabled)
        .build()
        .expect("settings")
}

#[tokio::test(flavor = "multi_thread")]
async fn a_new_member_is_named_by_their_registered_full_name() {
    citadel_logging::setup_log();
    let addr = start_production_server().await;
    assert_eq!(stored_name(registration(addr), false).await, FULL_NAME);
}

/// A record written before the fix carries the username as its name. The next
/// connect repairs it.
#[tokio::test(flavor = "multi_thread")]
async fn a_placeholder_name_is_repaired_on_the_next_connect() {
    citadel_logging::setup_log();
    let addr = start_production_server().await;
    assert_eq!(stored_name(registration(addr), true).await, FULL_NAME);
}
