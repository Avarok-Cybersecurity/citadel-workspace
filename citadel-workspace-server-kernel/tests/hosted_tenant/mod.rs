//! What the hosted-tenant tests share: an agent per test user, and asking the workspace server
//! through it. Moved verbatim from a_hosted_tenant_is_claimed_with_its_claim_code.rs so the
//! measured run (a_hosted_tenant_measured.rs) drives the tenant exactly the same way.
#![allow(dead_code)] // each test file uses a different subset

use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service_test_common::{get_free_port, spawn_services, InternalServicesFutures};
use citadel_internal_service_types::{
    InternalServiceRequest, InternalServiceResponse, MessageNotification, SecurityLevel,
};
use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use std::error::Error;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use uuid::Uuid;

pub const ANSWER_TIMEOUT: Duration = Duration::from_secs(30);

pub type ToAgent = UnboundedSender<InternalServiceRequest>;
pub type FromAgent = UnboundedReceiver<InternalServiceResponse>;

pub async fn spawn_agent(insecure: bool) -> Result<SocketAddr, Box<dyn Error>> {
    let bind: SocketAddr = format!("127.0.0.1:{}", get_free_port()).parse()?;
    let kernel = CitadelWorkspaceService::<_, StackedRatchet>::new_tcp(bind).await?;
    let mut builder = NodeBuilder::default();
    let builder = builder
        .with_backend(BackendType::InMemory)
        .with_node_type(NodeType::Peer);
    if insecure {
        let _ = builder.with_insecure_skip_cert_verification();
    }
    let node = builder.build(kernel)?;
    let futures: Vec<InternalServicesFutures> = vec![Box::pin(async move {
        node.await
            .map(|_| ())
            .map_err(|err| Box::from(err) as Box<dyn Error>)
    })];
    spawn_services(futures);
    Ok(bind)
}

/// Sends `request` to the workspace server and returns the first response `wanted` accepts,
/// skipping the broadcasts and acknowledgements that can arrive around it.
pub async fn ask(
    to: &ToAgent,
    from: &mut FromAgent,
    cid: u64,
    request: WorkspaceProtocolRequest,
    wanted: impl Fn(&WorkspaceProtocolResponse) -> bool,
) -> Result<WorkspaceProtocolResponse, Box<dyn Error>> {
    to.send(InternalServiceRequest::Message {
        request_id: Uuid::new_v4(),
        cid,
        message: serde_json::to_vec(&WorkspaceProtocolPayload::Request(request))?,
        peer_cid: None,
        security_level: SecurityLevel::Standard,
    })?;
    loop {
        let next = tokio::time::timeout(ANSWER_TIMEOUT, from.recv())
            .await?
            .ok_or("the agent's channel closed")?;
        if let InternalServiceResponse::MessageNotification(MessageNotification {
            message, ..
        }) = &next
        {
            if let Ok(WorkspaceProtocolPayload::Response(response)) =
                serde_json::from_slice::<WorkspaceProtocolPayload>(message)
            {
                if wanted(&response) {
                    return Ok(*response);
                }
                println!("(skipped server message: {response:?})");
                continue;
            }
        }
        println!("(skipped agent response: {next:?})");
    }
}

/// The request `WorkspaceInitializationModal.tsx` sends, with `password` as the master password.
pub fn initialize_and_become_admin(password: &str) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::UpdateWorkspace {
        workspace_id: None,
        name: None,
        description: None,
        workspace_master_password: password.to_string(),
        metadata: Some(br#"{"initialized":true}"#.to_vec()),
    }
}

pub async fn role_of(
    to: &ToAgent,
    from: &mut FromAgent,
    cid: u64,
    user: &str,
) -> Result<UserRole, Box<dyn Error>> {
    // The kernel enrols an account from its ConnectSuccess event, which can land after the
    // agent reported the connection; retry "not found" only.
    for _ in 0..20 {
        let response = ask(
            to,
            from,
            cid,
            WorkspaceProtocolRequest::GetMember {
                user_id: user.to_string(),
            },
            |r| {
                matches!(
                    r,
                    WorkspaceProtocolResponse::Member(_) | WorkspaceProtocolResponse::Error(_)
                )
            },
        )
        .await?;
        match response {
            WorkspaceProtocolResponse::Member(member) => return Ok(member.role),
            WorkspaceProtocolResponse::Error(e) if e.contains("not found") => {
                tokio::time::sleep(Duration::from_millis(250)).await
            }
            other => return Err(format!("GetMember {user}: {other:?}").into()),
        }
    }
    Err(format!("{user} was never enrolled").into())
}

/// Takes whatever the agent has already delivered, so the strict P2P helpers start clean.
pub async fn drain(from: &mut FromAgent, who: &str) {
    while let Ok(Some(stray)) = tokio::time::timeout(Duration::from_millis(1500), from.recv()).await
    {
        println!("(drained for {who}: {stray:?})");
    }
}

pub async fn send_and_expect(
    (to_sender, from_sender, sender_cid): (&ToAgent, &mut FromAgent, u64),
    (from_receiver, receiver_cid): (&mut FromAgent, u64),
    text: &str,
) -> Result<(), Box<dyn Error>> {
    to_sender.send(InternalServiceRequest::Message {
        message: text.as_bytes().to_vec(),
        cid: sender_cid,
        peer_cid: Some(receiver_cid),
        security_level: Default::default(),
        request_id: Uuid::new_v4(),
    })?;
    loop {
        match tokio::time::timeout(ANSWER_TIMEOUT, from_sender.recv()).await? {
            Some(InternalServiceResponse::MessageSendSuccess(_)) => break,
            Some(InternalServiceResponse::MessageSendFailure(f)) => {
                return Err(format!("{sender_cid} could not send: {f:?}").into())
            }
            other => println!("(skipped while sending: {other:?})"),
        }
    }
    loop {
        match tokio::time::timeout(ANSWER_TIMEOUT, from_receiver.recv()).await? {
            Some(InternalServiceResponse::MessageNotification(MessageNotification {
                message,
                cid,
                peer_cid,
                ..
            })) if peer_cid == sender_cid => {
                assert_eq!(cid, receiver_cid, "delivered to the wrong session");
                assert_eq!(&*message, text.as_bytes(), "message altered in transit");
                println!("DELIVERED {sender_cid} -> {receiver_cid}: {text:?}");
                return Ok(());
            }
            other => println!("(skipped while receiving: {other:?})"),
        }
    }
}

