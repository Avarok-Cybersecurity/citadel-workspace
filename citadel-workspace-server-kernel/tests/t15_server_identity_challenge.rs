//! T15 (identity doc §10 rev b; contract `server-identity-challenge.md`): the kernel's answer to
//! `ServerIdentityChallenge` signs `nonce ‖ cid ‖ domain` with the server key, where `cid` is the
//! session's own CID as the kernel knows it. The answer is the contract's known answer byte for
//! byte (ML-DSA-65 signing is deterministic), verifies under the pinned key for that session
//! only, and a signature replayed for another cid, domain or nonce fails. At most one answer per
//! second per session; none without a session.
//!
//! Real: `ServerIdentity::answer` and the command processor's dispatch, over the contract's KAT.

use citadel_identity::{
    canonical_domain, challenge_message, verify_server_challenge, MlDsa65Pk, NONCE_LEN,
};
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user_and_cid;
use citadel_workspace_server_kernel::kernel::server_identity::{
    hosted_identity, ServerIdentity, CHALLENGE_INTERVAL, NO_SESSION, TOO_SOON,
};
use citadel_workspace_types::server_identity::{ServerIdentity as Answer, ServerIdentityChallenge};
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use common::identity_kat::{bytes, identity_config_of, read_json, seed, server, text};
use common::workspace_test_utils::{create_configured_test_kernel, TEST_ADMIN_USER_ID};
use serde_json::Value;
use std::sync::Arc;
use std::time::Instant;

const SERVER: &str = "main.work.avarok.net";

fn kat_server() -> Value {
    server(SERVER)
}

fn identity() -> ServerIdentity {
    let document = read_json("fixtures/well-known-citadel/valid-hosted-tenant.json");
    hosted_identity(
        Some(&identity_config_of(&document)),
        &seed(&kat_server(), "/key/seed_hex"),
    )
    .expect("the KAT server's identity")
}

fn kat_cid() -> u64 {
    text(&kat_server(), "/challenge/cid").parse().expect("cid")
}

fn kat_nonce() -> [u8; NONCE_LEN] {
    bytes(&kat_server(), "/challenge/nonce_hex")
        .try_into()
        .expect("32-byte nonce")
}

fn answered(response: WorkspaceProtocolResponse) -> Answer {
    match response {
        WorkspaceProtocolResponse::ServerIdentity(answer) => answer,
        other => panic!("not answered: {other:?}"),
    }
}

fn pinned(answer: &Answer) -> MlDsa65Pk {
    MlDsa65Pk::from_bytes(&answer.pk).expect("a 1952-byte key")
}

#[test]
fn the_answer_is_the_contract_s_known_answer() {
    let challenge = ServerIdentityChallenge { nonce: kat_nonce() };
    let answer = answered(identity().answer(Some(kat_cid()), &challenge, Instant::now()));
    let kat = kat_server();
    assert_eq!(answer.domain, text(&kat, "/challenge/domain"));
    assert_eq!(answer.pk, bytes(&kat, "/key/pk_hex"));
    assert_eq!(
        challenge_message(&canonical_domain(SERVER).unwrap(), kat_cid(), &kat_nonce()),
        bytes(&kat, "/challenge/message_hex")
    );
    assert_eq!(answer.sig, bytes(&kat, "/challenge/sig_hex"));
}

#[test]
fn the_answer_verifies_for_this_session_only() {
    let challenge = ServerIdentityChallenge { nonce: kat_nonce() };
    let answer = answered(identity().answer(Some(kat_cid()), &challenge, Instant::now()));
    let pk = pinned(&answer);
    let domain = canonical_domain(SERVER).unwrap();
    verify_server_challenge(&pk, &domain, kat_cid(), &kat_nonce(), &answer.sig)
        .expect("the answer verifies under the pinned key for the session that asked");

    let replays = kat_server()["challenge_replays_that_must_fail"]
        .as_array()
        .expect("replays")
        .clone();
    assert_eq!(
        replays.len(),
        3,
        "the contract lists a cid, a domain and a nonce replay"
    );
    for replay in replays {
        let cid = replay["cid"]
            .as_str()
            .map_or(kat_cid(), |c| c.parse().unwrap());
        let other = replay["domain"]
            .as_str()
            .map_or(domain.clone(), |d| canonical_domain(d).unwrap());
        let nonce: [u8; NONCE_LEN] = match replay["nonce_hex"].as_str() {
            Some(hex) => hex::decode(hex).unwrap().try_into().unwrap(),
            None => kat_nonce(),
        };
        assert!(
            verify_server_challenge(&pk, &other, cid, &nonce, &answer.sig).is_err(),
            "a signature replayed as {replay} verified"
        );
    }
}

#[test]
fn a_session_is_answered_once_a_second_and_never_without_a_session() {
    let identity = identity();
    let challenge = ServerIdentityChallenge {
        nonce: [7; NONCE_LEN],
    };
    let start = Instant::now();
    answered(identity.answer(Some(1), &challenge, start));
    let again = identity.answer(Some(1), &challenge, start + CHALLENGE_INTERVAL / 2);
    assert!(
        matches!(&again, WorkspaceProtocolResponse::Error(e) if e == TOO_SOON),
        "{again:?}"
    );
    answered(identity.answer(Some(2), &challenge, start + CHALLENGE_INTERVAL / 2));
    answered(identity.answer(Some(1), &challenge, start + CHALLENGE_INTERVAL));
    let anonymous = identity.answer(None, &challenge, start);
    assert!(
        matches!(&anonymous, WorkspaceProtocolResponse::Error(e) if e == NO_SESSION),
        "{anonymous:?}"
    );
}

#[tokio::test]
async fn the_kernel_signs_for_the_cid_of_the_session_that_asked() {
    let identity = Arc::new(identity());
    let installed = identity.clone();
    let kernel =
        create_configured_test_kernel(move |k| k.set_server_identity(Some(installed))).await;
    let nonce = [0x33; NONCE_LEN];
    let request =
        WorkspaceProtocolRequest::ServerIdentityChallenge(ServerIdentityChallenge { nonce });
    let session_cid = 4242;
    let answer = answered(
        process_command_with_user_and_cid(&kernel, &request, TEST_ADMIN_USER_ID, Some(session_cid))
            .await
            .expect("answered"),
    );
    let domain = canonical_domain(SERVER).unwrap();
    let pk = pinned(&answer);
    verify_server_challenge(&pk, &domain, session_cid, &nonce, &answer.sig)
        .expect("signed for the session's own cid");
    assert!(verify_server_challenge(&pk, &domain, session_cid + 1, &nonce, &answer.sig).is_err());
}

#[test]
fn the_wire_refuses_unknown_fields_and_a_short_nonce() {
    let nonce: Vec<u8> = vec![1; NONCE_LEN];
    let good = format!(r#"{{"Request":{{"ServerIdentityChallenge":{{"nonce":{nonce:?}}}}}}}"#);
    assert!(
        serde_json::from_str::<WorkspaceProtocolPayload>(&good).is_ok(),
        "{good}"
    );
    let extra =
        format!(r#"{{"Request":{{"ServerIdentityChallenge":{{"nonce":{nonce:?},"cid":5}}}}}}"#);
    assert!(serde_json::from_str::<WorkspaceProtocolPayload>(&extra).is_err());
    let short: Vec<u8> = vec![1; NONCE_LEN - 1];
    let short = format!(r#"{{"Request":{{"ServerIdentityChallenge":{{"nonce":{short:?}}}}}}}"#);
    assert!(serde_json::from_str::<WorkspaceProtocolPayload>(&short).is_err());
}
