//! Legacy registration is not supported: a client that asks the workspace server to hash its
//! password itself (a registration with no post-quantum password factor) is refused before the
//! server hashes anything, by the limits both hosts share (`server_limits.rs`). A post-quantum
//! registration at the same server is taken, so the refusal is the legacy path's, not the
//! server's.

use citadel_io::ErrorCode;
use citadel_sdk::prelude::*;
use common::production_server::{start_production_server, TEST_CANONICAL_DOMAIN};
use common::sign_in_client::{drive, username, PASSWORD, TEST_SERVER_CERTIFICATE};
use futures::StreamExt;

/// A registration the way a client below post-quantum sign-in makes it: credentials only, no
/// post-quantum password factor. What the server answered, as its error text, or `Ok`.
async fn register_legacy(
    remote: &NodeRemote<StackedRatchet>,
    addr: std::net::SocketAddr,
    user: &str,
) -> Result<(), String> {
    let request = NodeRequest::RegisterToHypernode(RegisterToHypernode {
        remote_addr: addr,
        proposed_credentials: ProposedCredentials::new_register(user, user, PASSWORD.into())
            .await
            .map_err(|e| e.into_string())?,
        static_security_settings: citadel_sdk::prelude::default_session_security_settings(),
        session_password: Default::default(),
        endpoint: None,
        password: None,
        cert_verification: TEST_SERVER_CERTIFICATE,
        admission: None,
        recovery_domain: None,
    });
    let mut results = remote
        .send_callback_subscription(request)
        .await
        .map_err(|e| e.into_string())?;
    while let Some(result) = results.next().await {
        match result.into_result().map_err(|e| e.into_string())? {
            NodeResult::RegisterOkay(_) => return Ok(()),
            NodeResult::RegisterFailure(failure) => return Err(failure.error_message),
            _ => {}
        }
    }
    Err("the registration ended without an answer".to_string())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_legacy_registration_is_refused_and_a_post_quantum_one_is_taken() {
    citadel_logging::setup_log();
    let addr = start_production_server().await;
    drive(move |remote| async move {
        let refused = register_legacy(&remote, addr, &username("legacy")).await;
        assert_eq!(
            refused,
            Err(citadel_io::error!(ErrorCode::LegacyRegistrationRefused).into_string()),
            "the server took a legacy registration"
        );

        let user = username("pq");
        let registered = remote
            .register_admitted(
                addr,
                user.as_str(),
                user.as_str(),
                PASSWORD,
                citadel_sdk::prelude::default_session_security_settings(),
                None,
                None,
                Some(TEST_CANONICAL_DOMAIN.to_string()),
                TEST_SERVER_CERTIFICATE,
            )
            .await?;
        assert_eq!(
            registered.recovery_phrase.as_ref().map(Vec::len),
            Some(24),
            "a post-quantum registration was not taken"
        );
        Ok(())
    })
    .await
    .expect("the client ran");
}
