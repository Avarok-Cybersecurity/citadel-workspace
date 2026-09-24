//! `GetIceServers` hands relay (TURN) credentials to enrolled members only, and only from the
//! source the host passed at construction.
//!
//! Driven through `process_command_with_user`, the dispatch every client request takes. The
//! source here is an in-memory one: minting is the host's I/O (a Durable Object calling
//! Cloudflare), which is the boundary the kernel is built against, so this is the only double.

use async_trait::async_trait;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::kernel::ice_servers::{
    IceServerGrant, IceServerMember, IceServerSource, IceServersUnavailable,
};
use citadel_workspace_types::ice::IceServer;
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel};
use common::workspace_test_utils::{create_test_kernel, create_test_kernel_with_ice_servers};
use std::sync::{Arc, Mutex};

/// A refused account is told relay is unavailable, never given an `Error` (the UI shows every
/// Error as a failed operation) and never given servers.
fn refused(response: &WorkspaceProtocolResponse) -> bool {
    matches!(response, WorkspaceProtocolResponse::IceServersUnavailable { reason } if reason.contains("not available for your role"))
}

const EXPIRES_AT: u64 = 1_900_000_000;

/// Answers every mint with one fixed server, or declines with `decline`; records who asked.
struct InMemorySource {
    asked: Mutex<Vec<String>>,
    decline: Option<&'static str>,
}

impl InMemorySource {
    fn new(decline: Option<&'static str>) -> Arc<Self> {
        Arc::new(Self {
            asked: Mutex::new(Vec::new()),
            decline,
        })
    }

    fn asked(&self) -> Vec<String> {
        self.asked.lock().unwrap().clone()
    }
}

fn server() -> IceServer {
    IceServer {
        urls: vec!["turns:turn.example:443?transport=tcp".to_string()],
        username: Some("minted-user".to_string()),
        credential: Some("minted-credential".to_string()),
    }
}

#[async_trait]
impl IceServerSource for InMemorySource {
    async fn mint(
        &self,
        member: &IceServerMember,
    ) -> Result<IceServerGrant, IceServersUnavailable> {
        self.asked.lock().unwrap().push(member.user_id.clone());
        match self.decline {
            Some(reason) => Err(IceServersUnavailable(reason.to_string())),
            None => Ok(IceServerGrant {
                ice_servers: vec![server()],
                expires_at: EXPIRES_AT,
            }),
        }
    }
}

async fn kernel_with(source: &Arc<InMemorySource>) -> Arc<GateKernel> {
    create_test_kernel_with_ice_servers(Some(source.clone() as Arc<dyn IceServerSource>)).await
}

async fn enrol(kernel: &GateKernel, id: &str, role: UserRole) {
    insert_user_with_role(kernel, id, role).await;
    join_root(kernel, id).await;
}

async fn ask(kernel: &GateKernel, user: &str) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &WorkspaceProtocolRequest::GetIceServers, user)
        .await
        .expect("GetIceServers is answered, never an error of the transport")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_gets_the_servers_the_host_minted_for_them() {
    let source = InMemorySource::new(None);
    let kernel = kernel_with(&source).await;
    enrol(&kernel, "alice", UserRole::Member).await;

    match ask(&kernel, "alice").await {
        WorkspaceProtocolResponse::IceServers {
            ice_servers,
            expires_at,
        } => {
            assert_eq!(ice_servers, vec![server()]);
            assert_eq!(expires_at, EXPIRES_AT);
        }
        other => panic!("a member was not given servers: {other:?}"),
    }
    assert_eq!(
        source.asked(),
        vec!["alice".to_string()],
        "minted for the asking member"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_is_refused_and_nothing_is_minted() {
    let source = InMemorySource::new(None);
    let kernel = kernel_with(&source).await;
    enrol(&kernel, "visitor", UserRole::Guest).await;

    let response = ask(&kernel, "visitor").await;
    assert!(refused(&response), "a guest must be refused: {response:?}",);
    assert!(source.asked().is_empty(), "nothing is minted for a guest");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_removed_or_unenrolled_account_is_refused() {
    let source = InMemorySource::new(None);
    let kernel = kernel_with(&source).await;
    enrol(&kernel, "removed", UserRole::Banned).await;
    // A Member record that is not in the workspace's member list.
    insert_user_with_role(&kernel, "stranger", UserRole::Member).await;

    for user in ["removed", "stranger", "nobody-at-all"] {
        let response = ask(&kernel, user).await;
        assert!(refused(&response), "{user} must be refused: {response:?}",);
    }
    assert!(source.asked().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn with_no_source_a_member_is_told_no_relay_is_available() {
    let kernel = create_test_kernel().await;
    enrol(&kernel, "alice", UserRole::Member).await;

    let response = ask(&kernel, "alice").await;
    assert!(
        matches!(
            &response,
            WorkspaceProtocolResponse::IceServersUnavailable { .. }
        ),
        "no source must answer unavailable, not servers and not an error: {response:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_host_that_declines_is_reported_with_its_reason() {
    let source = InMemorySource::new(Some("this workspace's plan has used its included relay"));
    let kernel = kernel_with(&source).await;
    enrol(&kernel, "alice", UserRole::Owner).await;

    match ask(&kernel, "alice").await {
        WorkspaceProtocolResponse::IceServersUnavailable { reason } => {
            assert_eq!(reason, "this workspace's plan has used its included relay")
        }
        other => panic!("a declined mint must be reported as unavailable: {other:?}"),
    }
}
