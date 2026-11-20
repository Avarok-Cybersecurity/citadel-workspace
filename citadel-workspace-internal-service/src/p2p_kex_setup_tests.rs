//! The P2P key-exchange identity as this binary wires it, end to end: agents built as `main.rs`
//! builds them (`identity_setup::applied` and `kex_identity`), on the shipped server in process,
//! driven over their own request protocol as a window drives them. The server also takes
//! accounts registered with a typed password (`allow_legacy`), so a legacy account can join.
//!
//! - Two identity accounts, each signed in the normal way (create, register): each end's link
//!   names the other's identity fingerprint.
//! - A legacy account (a typed password, no identity) still connects: its peer marks it
//!   unverified, and it still checks the identity peer's signature.
//! - A locked identity cannot sign an account in: the refusal names the lock.
//!
//! Control: drop `.with_p2p_kex_identity(kex)` from `agent` (as `main.rs` was before) → both
//! identity ends read `Unverified` and the first assertion fails.

use citadel_internal_service_types::{
    FailureReason, InternalServiceRequest, InternalServiceResponse, PeerIdentityMark,
};
use citadel_workspace_server_kernel_test_common::production_server::start_server_named_localhost_taking;
use support::*;
use uuid::Uuid;

#[path = "p2p_kex_setup_support.rs"]
mod support;

#[tokio::test(flavor = "multi_thread")]
async fn the_shipped_agent_signs_with_the_identity_and_marks_a_legacy_peer_unverified() {
    common::setup_log();
    let (server, server_fp) = start_server_named_localhost_taking("allow_legacy").await;
    let (alice_data, bob_data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (alice_agent, bob_agent) = (agent(alice_data.path()).await, agent(bob_data.path()).await);

    let (mut sink, mut stream) = open(alice_agent).await;
    let alice_fp = create_identity(&mut sink, &mut stream).await;
    let (id, request) = register_identity(&server, &server_fp, "alice");
    let mut alice = signed_in(sink, stream, id, request).await;
    let (mut sink, mut stream) = open(bob_agent).await;
    let bob_fp = create_identity(&mut sink, &mut stream).await;
    let (id, request) = register_identity(&server, &server_fp, "bob");
    let mut bob = signed_in(sink, stream, id, request).await;
    assert_eq!(
        link(&mut alice, &mut bob).await,
        [verified(&bob_fp), verified(&alice_fp)]
    );

    // A legacy account beside bob's, on bob's agent: no identity signs its exchanges.
    let (sink, stream) = open(bob_agent).await;
    let request_id = Uuid::new_v4();
    let register = InternalServiceRequest::Register {
        request_id,
        server_addr: server.clone(),
        full_name: "Legacy".to_string(),
        username: format!("legacy{}", &Uuid::new_v4().simple().to_string()[..8]),
        proposed_password: b"a typed password".to_vec().into(),
        connect_after_register: true,
        session_security_settings: Default::default(),
        server_password: None,
        admission_token: None,
    };
    let mut legacy = signed_in(sink, stream, request_id, register).await;
    let [at_legacy, at_alice] = link(&mut legacy, &mut alice).await;
    assert_eq!(
        at_legacy,
        verified(&alice_fp),
        "the legacy end still checks alice's signature"
    );
    assert_eq!(
        at_alice,
        PeerIdentityMark::Unverified,
        "an unsigned peer is marked unverified"
    );

    // Locked, the identity signs no new account in, and says why.
    let request_id = Uuid::new_v4();
    send(
        &mut alice.sink,
        InternalServiceRequest::IdentityLock { request_id },
    )
    .await;
    expect(&mut alice.stream, |r| {
        matches!(r, InternalServiceResponse::IdentitySuccess(s) if s.request_id == Some(request_id))
            .then_some(())
    })
    .await;
    let (id, request) = register_identity(&server, &server_fp, "dave");
    send(&mut alice.sink, request).await;
    let refused = expect(&mut alice.stream, |r| match r {
        InternalServiceResponse::RegisterFailure(f) if f.request_id == Some(id) => {
            Some(f.reason_code)
        }
        InternalServiceResponse::ConnectSuccess(s) if s.request_id == Some(id) => {
            panic!("a locked identity signed dave in")
        }
        _ => None,
    })
    .await;
    assert_eq!(refused, Some(FailureReason::IdentityLocked));
}
