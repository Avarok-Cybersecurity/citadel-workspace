//! A member of a hosted tenant gets short-lived Cloudflare TURN credentials from the tenant's
//! Durable Object, end to end: the real Worker, its minter and Cloudflare's credential API.
//!
//! Ignored unless told which tenant to ask:
//!
//! ```text
//! CITADEL_TENANT_PROOF_ENDPOINT=wss://bench.work.avarok.net/bench \
//!   cargo test -p citadel-workspace-server-kernel \
//!     --test a_hosted_tenant_mints_relay_servers -- --ignored --nocapture
//! ```
//!
//! A fresh account registers, so it joins as a plain member; that is who the relay is for.
//! Nothing secret is printed: only whether each server carries a username and a credential.

mod hosted_tenant;
use hosted_tenant::*;

use citadel_internal_service_test_common::{
    self as agent_common, register_and_connect_to_server, RegisterAndConnectItems,
};
use citadel_sdk::prelude::*;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use std::error::Error;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const ENDPOINT_VAR: &str = "CITADEL_TENANT_PROOF_ENDPOINT";

fn relay_answer(r: &WorkspaceProtocolResponse) -> bool {
    matches!(
        r,
        WorkspaceProtocolResponse::IceServers { .. }
            | WorkspaceProtocolResponse::IceServersUnavailable { .. }
            | WorkspaceProtocolResponse::Error(_)
    )
}

#[tokio::test]
#[ignore = "needs a hosted tenant at CITADEL_TENANT_PROOF_ENDPOINT"]
async fn a_member_of_a_hosted_tenant_gets_turn_credentials() -> Result<(), Box<dyn Error>> {
    agent_common::setup_log();
    let endpoint = std::env::var(ENDPOINT_VAR)
        .map_err(|_| format!("{ENDPOINT_VAR} must name the tenant, e.g. wss://bench.work.avarok.net/bench"))?;
    let run = Uuid::new_v4().to_string();
    let member = format!("relay.{}", &run[..8]);
    let agent = spawn_agent(false).await?;
    tokio::time::sleep(Duration::from_millis(500)).await;

    let mut connected = register_and_connect_to_server(vec![RegisterAndConnectItems {
        internal_service_addr: agent,
        server_addr: endpoint.clone(),
        full_name: "Relay Probe".to_string(),
        username: member.clone(),
        password: format!("secret-{run}").into_bytes(),
        pre_shared_key: None::<PreSharedKey>,
    }])
    .await?;
    let (to, from, cid) = connected.pop().ok_or("the agent did not connect")?;
    let mut from = from;
    let role = role_of(&to, &mut from, cid, &member).await?;
    println!("CONNECTED {member} (cid {cid}) to {endpoint} as {role:?}");

    let first = ask(&to, &mut from, cid, WorkspaceProtocolRequest::GetIceServers, relay_answer).await?;
    let WorkspaceProtocolResponse::IceServers { ice_servers, expires_at } = first else {
        return Err(format!("the tenant gave no relay servers: {first:?}").into());
    };
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    for server in &ice_servers {
        println!(
            "SERVER {:?} username={} credential={}",
            server.urls,
            server.username.is_some(),
            server.credential.is_some()
        );
    }
    let urls: Vec<&String> = ice_servers.iter().flat_map(|s| s.urls.iter()).collect();
    assert!(
        urls.iter().any(|u| u.starts_with("turns:") && u.contains(":443")),
        "no TURN over TLS on 443 among {urls:?}"
    );
    assert!(
        ice_servers.iter().any(|s| s.urls.iter().any(|u| u.starts_with("turn")) && s.username.is_some() && s.credential.is_some()),
        "no TURN server carries credentials"
    );
    assert!(expires_at > now + 60 && expires_at <= now + 48 * 3600, "expires_at {expires_at} is not a short future lifetime (now {now})");
    println!("EXPIRES in {}s", expires_at - now);

    // Asked again at once: the Durable Object answers from its cache, not with a second mint.
    let second = ask(&to, &mut from, cid, WorkspaceProtocolRequest::GetIceServers, relay_answer).await?;
    let WorkspaceProtocolResponse::IceServers { expires_at: again, .. } = second else {
        return Err(format!("the second ask gave no relay servers: {second:?}").into());
    };
    assert_eq!(again, expires_at, "a second mint within the cache window");
    println!("RELAY PASS {endpoint}: a member got TURN credentials, cached on the second ask");
    Ok(())
}
