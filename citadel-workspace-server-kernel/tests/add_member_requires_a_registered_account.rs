//! `AddMember` admits only accounts that are registered on this server.
//!
//! `add_user_to_domain` minted a `User` record for any username it was given,
//! so a typo in the Add member dialog produced a phantom member: listed in the
//! roster, holding a role, and belonging to nobody.
//!
//! Run end to end against the production server, because registration lives
//! in the SDK's account store, not in the kernel's records -- a kernel with an
//! injected user could not show which of the two is asked.

use citadel_sdk::prefabs::client::single_connection::SingleClientServerConnectionKernel;
use citadel_sdk::prefabs::client::ServerConnectionSettingsBuilder;
use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use common::production_server::start_production_server_with;
use futures::StreamExt;
use std::net::SocketAddr;
use std::time::Duration;

const ADMIN: &str = "admin0925";
const REGISTERED: &str = "bob0925";
const TYPO: &str = "bobb0925";
const PASSWORD: &str = "password123";
const MUST_ANSWER_WITHIN: Duration = Duration::from_secs(90);

/// Sends `request` and returns the first response.
async fn ask<R: Ratchet>(
    tx: &mut PeerChannelSendHalf<R>,
    rx: &mut PeerChannelRecvHalf<R>,
    request: WorkspaceProtocolRequest,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let payload = WorkspaceProtocolPayload::Request(request);
    tx.send(serde_json::to_vec(&payload).expect("encode"))
        .await?;
    while let Some(bytes) = rx.next().await {
        if let Ok(WorkspaceProtocolPayload::Response(response)) =
            serde_json::from_slice::<WorkspaceProtocolPayload>(bytes.as_ref())
        {
            return Ok(*response);
        }
    }
    Err(NetworkError::msg("the channel closed before a response"))
}

/// Asks for `user_id`'s record until it exists: enrolment runs on its own task
/// after ConnectSuccess, so the first ask can land before it.
async fn wait_for_record<R: Ratchet>(
    tx: &mut PeerChannelSendHalf<R>,
    rx: &mut PeerChannelRecvHalf<R>,
    user_id: &str,
) -> Result<(), NetworkError> {
    for _ in 0..50 {
        let request = WorkspaceProtocolRequest::GetMember {
            user_id: user_id.to_string(),
        };
        if let WorkspaceProtocolResponse::Member(_) = ask(tx, rx, request).await? {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(NetworkError::msg(format!("{user_id} was never enrolled")))
}

fn registration(addr: SocketAddr, username: &str) -> ServerConnectionSettings<StackedRatchet> {
    ServerConnectionSettingsBuilder::credentialed_registration(addr, username, username, PASSWORD)
        .with_udp_mode(UdpMode::Disabled)
        .build()
        .expect("settings")
}

/// Runs a client node with `settings` until `on_connect` finishes, and returns
/// what it produced.
async fn run_client<T, F, Fut>(
    settings: ServerConnectionSettings<StackedRatchet>,
    on_connect: F,
) -> T
where
    T: Send + 'static,
    F: FnOnce(CitadelClientServerConnection<StackedRatchet>) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<T, NetworkError>> + Send + 'static,
{
    let (done_tx, done_rx) = tokio::sync::oneshot::channel::<T>();
    let slot = std::sync::Mutex::new(Some((done_tx, on_connect)));
    let kernel = SingleClientServerConnectionKernel::new(settings, move |conn| {
        let taken = slot.lock().unwrap().take();
        async move {
            let (done_tx, on_connect) = taken.expect("connected once");
            let _ = done_tx.send(on_connect(conn).await?);
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
        Ok(found) = done_rx => found,
        done = client => panic!("the client ended first: {:?}", done.map(|r| r.err())),
        _ = tokio::time::sleep(MUST_ANSWER_WITHIN) => panic!("no answer within {MUST_ANSWER_WITHIN:?}"),
    }
}

struct Outcomes {
    registered: WorkspaceProtocolResponse,
    typo: WorkspaceProtocolResponse,
    typo_record: WorkspaceProtocolResponse,
}

#[tokio::test(flavor = "multi_thread")]
async fn only_a_registered_account_can_be_added() {
    citadel_logging::setup_log();
    // The first account to connect administers the workspace, so the actor
    // holds AddUsers and the only thing that can refuse the typo is its name.
    let addr = start_production_server_with("allow_first_connect_admin = true\n").await;

    let outcomes = run_client(registration(addr, ADMIN), move |mut conn| async move {
        let (mut tx, mut rx) = conn.take_channel().expect("channel").split();
        wait_for_record(&mut tx, &mut rx, ADMIN).await?;

        // A second, real account, registered on the same server.
        run_client(registration(addr, REGISTERED), |_conn| async { Ok(()) }).await;

        let add = |user_id: &str| WorkspaceProtocolRequest::AddMember {
            user_id: user_id.to_string(),
            domain_id: None,
            role: UserRole::Member,
            metadata: None,
        };
        let registered = ask(&mut tx, &mut rx, add(REGISTERED)).await?;
        let typo = ask(&mut tx, &mut rx, add(TYPO)).await?;
        let typo_record = ask(
            &mut tx,
            &mut rx,
            WorkspaceProtocolRequest::GetMember {
                user_id: TYPO.to_string(),
            },
        )
        .await?;
        Ok(Outcomes {
            registered,
            typo,
            typo_record,
        })
    })
    .await;

    assert!(
        matches!(&outcomes.registered, WorkspaceProtocolResponse::Success(m) if m == "Member added successfully"),
        "a registered account must still be addable, got {:?}",
        outcomes.registered
    );
    let expected = format!("No account named '{TYPO}' exists on this workspace");
    assert!(
        matches!(&outcomes.typo, WorkspaceProtocolResponse::Error(m) if m.contains(&expected)),
        "an unregistered username must be refused by name, got {:?}",
        outcomes.typo
    );
    assert!(
        !matches!(outcomes.typo_record, WorkspaceProtocolResponse::Member(_)),
        "a refused add must not leave a record behind, got {:?}",
        outcomes.typo_record
    );
}
