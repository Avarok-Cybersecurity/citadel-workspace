//! A colleague who joins appears for everyone already signed in.
//!
//! Connect enrolment wrote the newcomer into the root workspace and announced
//! nothing, unlike every other workspace write. A member signed in before them
//! had loaded the roster once, so the newcomer stayed invisible until a reload
//! -- in a workspace whose default is that every colleague may message every
//! other. Run end to end against the production server, because enrolment
//! lives in the connection handler and nowhere a kernel test can call.

use citadel_sdk::prefabs::client::single_connection::SingleClientServerConnectionKernel;
use citadel_sdk::prefabs::client::ServerConnectionSettingsBuilder;
use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::User;
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use common::production_client::ask;
use common::production_server::start_production_server;
use futures::StreamExt;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::oneshot;

const PASSWORD: &str = "password123";
const WITHIN: Duration = Duration::from_secs(90);
const FIRST: &str = "alice1015";
const SECOND: &str = "bob1015";
const NEWCOMER: &str = "carol1015";

/// What a session reports back to the test.
struct Reports {
    enrolled: oneshot::Sender<()>,
    /// With a newcomer's name: the member list of the first announcement naming them.
    watch: Option<(&'static str, oneshot::Sender<Vec<String>>)>,
}

/// Reads announcements until one lists `newcomer`, and returns its members.
async fn announcement_naming<R: Ratchet>(
    rx: &mut PeerChannelRecvHalf<R>,
    newcomer: &str,
) -> Result<Vec<String>, NetworkError> {
    while let Some(bytes) = rx.next().await {
        if let Ok(WorkspaceProtocolPayload::Response(response)) =
            serde_json::from_slice::<WorkspaceProtocolPayload>(bytes.as_ref())
        {
            if let WorkspaceProtocolResponse::Workspace(workspace) = *response {
                if workspace.members.iter().any(|m| m == newcomer) {
                    return Ok(workspace.members);
                }
            }
        }
    }
    Err(NetworkError::msg(
        "the channel closed before the announcement",
    ))
}

/// Registers and connects `username`, reports enrolment, then optionally watches.
fn session(addr: SocketAddr, username: &'static str, reports: Reports) {
    let settings = ServerConnectionSettingsBuilder::credentialed_registration(
        addr, username, username, PASSWORD,
    )
    .with_udp_mode(UdpMode::Disabled)
    .build()
    .expect("settings");
    let reports = Mutex::new(Some(reports));
    let kernel = SingleClientServerConnectionKernel::new(settings, move |mut conn| {
        let reports = reports.lock().expect("reports").take();
        async move {
            let Some(Reports { enrolled, watch }) = reports else {
                return Ok(());
            };
            let (mut tx, mut rx) = conn.take_channel().expect("channel").split();
            let own = WorkspaceProtocolRequest::GetMember {
                user_id: username.to_string(),
            };
            ask(&mut tx, &mut rx, own, |r| match r {
                WorkspaceProtocolResponse::Member(user) => Some::<User>(user),
                _ => None,
            })
            .await?;
            let _ = enrolled.send(());
            if let Some((newcomer, seen)) = watch {
                let _ = seen.send(announcement_naming(&mut rx, newcomer).await?);
            }
            Ok(())
        }
    });
    let node = DefaultNodeBuilder::default()
        .with_backend(BackendType::InMemory)
        .with_insecure_skip_cert_verification()
        .build(kernel)
        .expect("client node");
    drop(tokio::spawn(node));
}

async fn within<T>(what: &str, rx: oneshot::Receiver<T>) -> T {
    tokio::time::timeout(WITHIN, rx)
        .await
        .unwrap_or_else(|_| panic!("{what} within {WITHIN:?}"))
        .unwrap_or_else(|_| panic!("{what}: the session ended first"))
}

/// Connects a watcher and waits until the server has enrolled it.
async fn watcher(addr: SocketAddr, username: &'static str) -> oneshot::Receiver<Vec<String>> {
    let (enrolled, enrolled_rx) = oneshot::channel();
    let (seen, seen_rx) = oneshot::channel();
    let watch = Some((NEWCOMER, seen));
    session(addr, username, Reports { enrolled, watch });
    within(&format!("{username} enrolled"), enrolled_rx).await;
    seen_rx
}

#[tokio::test(flavor = "multi_thread")]
async fn members_already_signed_in_are_told_a_colleague_joined() {
    citadel_logging::setup_log();
    let addr = start_production_server().await;
    let first = watcher(addr, FIRST).await;
    let second = watcher(addr, SECOND).await;

    let (enrolled, newcomer_enrolled) = oneshot::channel();
    session(
        addr,
        NEWCOMER,
        Reports {
            enrolled,
            watch: None,
        },
    );
    within("the newcomer enrolled", newcomer_enrolled).await;

    for (who, seen) in [(FIRST, first), (SECOND, second)] {
        let members = within(&format!("{who} told of {NEWCOMER}"), seen).await;
        for expected in [FIRST, SECOND, NEWCOMER] {
            assert!(
                members.iter().any(|m| m == expected),
                "{who}'s announcement must carry the whole roster; missing {expected}: {members:?}"
            );
        }
    }
}
