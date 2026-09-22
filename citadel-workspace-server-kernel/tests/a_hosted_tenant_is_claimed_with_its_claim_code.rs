//! A hosted tenant, end to end: created by the control plane, claimed with its claim code over
//! the agent's WebSocket path, joined by a second agent, and used for a P2P message.
//!
//! The server is external -- the tenant worker's Durable Object under `wrangler dev`, with the
//! tenant created through the control plane (`deploy/tenant-worker/serve-tenants.mjs` writes the
//! claim codes it was shown to a file) -- so this is ignored unless it is told where both are:
//!
//! ```text
//! CITADEL_TENANT_PROOF_ENDPOINT=wss://localhost:8828/acme \
//! CITADEL_TENANT_PROOF_CLAIMS=/path/to/claims.json CITADEL_TENANT_PROOF_INSECURE=1 \
//!   cargo test -p citadel-workspace-server-kernel \
//!     --test a_hosted_tenant_is_claimed_with_its_claim_code -- --ignored --nocapture
//! ```
//!
//! The tenant is the endpoint's last path segment. `CITADEL_TENANT_PROOF_INSECURE=1` skips
//! certificate verification for wrangler's self-signed edge.
//!
//! Everything in between is the real thing: two `CitadelWorkspaceService` agents, each its own
//! Peer node, register and log in to the tenant by URL; the first sends the request the UI's
//! "Initialize & Become Admin" modal sends (`WorkspaceInitializationModal.tsx`: UpdateWorkspace on
//! the root with the master password and `{"initialized":true}`), with the claim code as the
//! master password; the kernel in the object makes it Admin and owner; the second joins as a
//! plain member; they register with each other through the object and exchange a message.

use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service_test_common::{
    self as agent_common, connect_p2p, get_free_port, register_and_connect_to_server, register_p2p,
    spawn_services, InternalServicesFutures, RegisterAndConnectItems,
};
use citadel_internal_service_types::{
    InternalServiceRequest, InternalServiceResponse, MessageNotification, SecurityLevel,
};
use citadel_sdk::prelude::*;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use std::collections::HashMap;
use std::error::Error;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use uuid::Uuid;

const ENDPOINT_VAR: &str = "CITADEL_TENANT_PROOF_ENDPOINT";
const CLAIMS_VAR: &str = "CITADEL_TENANT_PROOF_CLAIMS";
const INSECURE_VAR: &str = "CITADEL_TENANT_PROOF_INSECURE";
const ANSWER_TIMEOUT: Duration = Duration::from_secs(30);

type ToAgent = UnboundedSender<InternalServiceRequest>;
type FromAgent = UnboundedReceiver<InternalServiceResponse>;

async fn spawn_agent(insecure: bool) -> Result<SocketAddr, Box<dyn Error>> {
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
async fn ask(
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
fn initialize_and_become_admin(password: &str) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::UpdateWorkspace {
        workspace_id: None,
        name: None,
        description: None,
        workspace_master_password: password.to_string(),
        metadata: Some(br#"{"initialized":true}"#.to_vec()),
    }
}

async fn role_of(
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
async fn drain(from: &mut FromAgent, who: &str) {
    while let Ok(Some(stray)) = tokio::time::timeout(Duration::from_millis(1500), from.recv()).await
    {
        println!("(drained for {who}: {stray:?})");
    }
}

async fn send_and_expect(
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

#[tokio::test]
#[ignore = "needs a tenant served at CITADEL_TENANT_PROOF_ENDPOINT (serve-tenants.mjs)"]
async fn the_claim_code_makes_the_creator_admin_and_the_tenant_carries_p2p(
) -> Result<(), Box<dyn Error>> {
    agent_common::setup_log();
    let endpoint = std::env::var(ENDPOINT_VAR).map_err(|_| {
        format!("{ENDPOINT_VAR} must name the tenant, e.g. wss://localhost:8828/acme")
    })?;
    let claims_file =
        std::env::var(CLAIMS_VAR).map_err(|_| format!("{CLAIMS_VAR} must name the claims file"))?;
    let insecure = std::env::var(INSECURE_VAR).as_deref() == Ok("1");
    let tenant = endpoint
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .ok_or("the endpoint names no tenant")?
        .to_string();
    let claims: HashMap<String, String> = serde_json::from_slice(&std::fs::read(&claims_file)?)?;
    let claim_code = claims
        .get(&tenant)
        .ok_or_else(|| format!("{claims_file} holds no claim code for {tenant}"))?
        .clone();

    let run = Uuid::new_v4().to_string();
    let creator = format!("creator.{}", &run[..8]);
    let teammate = format!("teammate.{}", &run[..8]);
    let agent_a = spawn_agent(insecure).await?;
    let agent_b = spawn_agent(insecure).await?;
    tokio::time::sleep(Duration::from_millis(500)).await;

    // The creator registers and logs in over the agent's WebSocket path.
    let mut a = register_and_connect_to_server(vec![RegisterAndConnectItems {
        internal_service_addr: agent_a,
        server_addr: endpoint.clone(),
        full_name: "Creator".to_string(),
        username: creator.clone(),
        password: format!("secret-a-{run}").into_bytes(),
        pre_shared_key: None::<PreSharedKey>,
    }])
    .await?;
    let (to_a, from_a, cid_a) = a.pop().ok_or("agent a did not connect")?;
    let mut from_a = from_a;
    println!("CONNECTED creator {creator} (cid {cid_a}) to {endpoint}");

    let before = role_of(&to_a, &mut from_a, cid_a, &creator).await?;
    println!("ROLE before claim: {before:?}");
    assert!(
        !matches!(before, UserRole::Admin | UserRole::Owner),
        "the creator was an admin before claiming: {before:?}"
    );

    // A wrong code is refused: the claim is the code, not the request.
    let wrong = ask(
        &to_a,
        &mut from_a,
        cid_a,
        initialize_and_become_admin(&"0".repeat(64)),
        |r| {
            matches!(
                r,
                WorkspaceProtocolResponse::Workspace(_) | WorkspaceProtocolResponse::Error(_)
            )
        },
    )
    .await?;
    println!("CLAIM with a wrong code: {wrong:?}");
    assert!(
        matches!(wrong, WorkspaceProtocolResponse::Error(_)),
        "a wrong code was accepted"
    );

    let claimed = ask(
        &to_a,
        &mut from_a,
        cid_a,
        initialize_and_become_admin(&claim_code),
        |r| {
            matches!(
                r,
                WorkspaceProtocolResponse::Workspace(_) | WorkspaceProtocolResponse::Error(_)
            )
        },
    )
    .await?;
    let WorkspaceProtocolResponse::Workspace(workspace) = claimed else {
        return Err(format!("the claim was refused: {claimed:?}").into());
    };
    println!(
        "CLAIMED {tenant}: workspace {} owner={} initialized={}",
        workspace.id,
        workspace.owner_id,
        String::from_utf8_lossy(&workspace.metadata)
    );
    assert_eq!(workspace.id, WORKSPACE_ROOT_ID);
    assert_eq!(workspace.owner_id, creator, "the claimant is not the owner");
    let metadata: serde_json::Value = serde_json::from_slice(&workspace.metadata)?;
    assert_eq!(metadata["initialized"], serde_json::Value::Bool(true));
    let after = role_of(&to_a, &mut from_a, cid_a, &creator).await?;
    println!("ROLE after claim: {after:?}");
    assert_eq!(
        after,
        UserRole::Admin,
        "the claim did not make the creator Admin"
    );

    // The teammate joins the same tenant and is a plain member.
    let mut b = register_and_connect_to_server(vec![RegisterAndConnectItems {
        internal_service_addr: agent_b,
        server_addr: endpoint.clone(),
        full_name: "Teammate".to_string(),
        username: teammate.clone(),
        password: format!("secret-b-{run}").into_bytes(),
        pre_shared_key: None::<PreSharedKey>,
    }])
    .await?;
    let (mut to_b, from_b, cid_b) = b.pop().ok_or("agent b did not connect")?;
    let mut from_b = from_b;
    println!("CONNECTED teammate {teammate} (cid {cid_b})");
    let teammate_role = role_of(&to_b, &mut from_b, cid_b, &teammate).await?;
    println!("ROLE teammate: {teammate_role:?}");
    assert!(
        !matches!(teammate_role, UserRole::Admin | UserRole::Owner),
        "the teammate is {teammate_role:?} without claiming"
    );
    // The code is spent: the teammate presenting it is refused.
    let second_claim = ask(
        &to_b,
        &mut from_b,
        cid_b,
        initialize_and_become_admin(&claim_code),
        |r| {
            matches!(
                r,
                WorkspaceProtocolResponse::Workspace(_) | WorkspaceProtocolResponse::Error(_)
            )
        },
    )
    .await?;
    println!("SECOND CLAIM by the teammate: {second_claim:?}");
    assert!(
        matches!(second_claim, WorkspaceProtocolResponse::Error(_)),
        "the claim code worked twice"
    );
    assert_eq!(
        role_of(&to_a, &mut from_a, cid_a, &creator).await?,
        UserRole::Admin
    );

    drain(&mut from_a, "creator").await;
    drain(&mut from_b, "teammate").await;
    let mut to_a = to_a;
    let settings = SessionSecuritySettingsBuilder::default().build()?;
    register_p2p(
        &mut to_a,
        &mut from_a,
        cid_a,
        &mut to_b,
        &mut from_b,
        cid_b,
        settings,
        None,
    )
    .await?;
    println!("P2P REGISTERED {cid_a} <-> {cid_b}");
    connect_p2p(
        &mut to_a,
        &mut from_a,
        cid_a,
        &mut to_b,
        &mut from_b,
        cid_b,
        settings,
        None,
    )
    .await?;
    println!("P2P CONNECTED {cid_a} <-> {cid_b}");
    send_and_expect(
        (&to_a, &mut from_a, cid_a),
        (&mut from_b, cid_b),
        "welcome to the workspace",
    )
    .await?;
    send_and_expect(
        (&to_b, &mut from_b, cid_b),
        (&mut from_a, cid_a),
        "thanks, admin",
    )
    .await?;
    println!("E2E PASS {endpoint}: claim code -> Admin, teammate Member, P2P both ways");
    Ok(())
}
