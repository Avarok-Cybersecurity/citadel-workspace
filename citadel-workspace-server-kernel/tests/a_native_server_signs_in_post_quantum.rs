//! A self-hosted server offers post-quantum sign-in, and security keys with it.
//!
//! Before kernel.toml's `[sign_in]`, the native server started with no `pq_sign_in`: every
//! account registered the legacy way (server-side Argon2), and no account could enrol a
//! security key, because a key is a post-quantum factor. Run against
//! `run_server_with_base_path` itself, so this proves the server people deploy is built with it.
//!
//! The client sees which way it registered: a post-quantum registration hands back its ten
//! recovery codes, a legacy one none (`RegisterSuccess::recovery_codes`).

use citadel_sdk::prelude::*;
use common::production_server::start_production_server;
use common::sign_in_client::{drive, sign_in, username, PASSWORD};

const CREDENTIAL: &[u8] = b"native-test-security-key";

/// A security key that answers every touch with `prf` for `CREDENTIAL`, as an agent relaying a
/// browser's WebAuthn ceremony would. The SDK's own factor suite uses the same stand-in: the
/// authenticator is hardware, and the protocol only ever sees its PRF output.
fn key(prf: u8) -> SecurityKeyPrf {
    let (key, mut touches) = security_key_channel();
    drop(tokio::spawn(async move {
        while let Some(touch) = touches.recv().await {
            touch.answer(CREDENTIAL.to_vec(), [prf; 32]);
        }
    }));
    key
}

fn password() -> SignInFactors {
    SignInFactors::password(PASSWORD)
}

#[tokio::test(flavor = "multi_thread")]
async fn an_account_registers_and_signs_in_post_quantum() {
    citadel_logging::setup_log();
    let addr = start_production_server().await;
    let user = username("pq");
    drive(move |remote| async move {
        let registered = remote
            .register_with_defaults(addr, user.as_str(), user.as_str(), PASSWORD)
            .await?;
        assert_eq!(
            registered.recovery_codes.len(),
            10,
            "the native server registered this account the legacy way"
        );
        let conn = sign_in(&remote, &user, password()).await?;
        assert!(conn.rekey().await?.is_some(), "the session cannot ratchet");
        conn.disconnect().await?;
        let wrong = sign_in(
            &remote,
            &user,
            SignInFactors::password("battery horse correct"),
        )
        .await;
        assert!(wrong.is_err(), "a wrong password signed in");
        Ok(())
    })
    .await
    .expect("post-quantum sign-in");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_security_key_is_enrolled_and_then_required() {
    citadel_logging::setup_log();
    let addr = start_production_server().await;
    let user = username("key");
    drive(move |remote| async move {
        remote
            .register_with_defaults(addr, user.as_str(), user.as_str(), PASSWORD)
            .await?;
        let conn = sign_in(&remote, &user, password()).await?;
        let add = SignInManagementOp::AddSecurityKey {
            credential_id: CREDENTIAL.to_vec(),
            label: "YubiKey".into(),
        };
        let added = conn
            .manage_sign_in(add, password().with_security_key(key(7)))
            .await?;
        assert!(
            matches!(added, SignInManagementOutcome::Added { .. }),
            "{added:?}"
        );
        let require = SignInManagementOp::SetSignInPolicy {
            policy: SignInPolicy::PasswordAndKey,
        };
        let set = conn
            .manage_sign_in(require, password().with_security_key(key(7)))
            .await?;
        assert_eq!(set, SignInManagementOutcome::PolicySet);
        conn.disconnect().await?;

        assert!(
            sign_in(&remote, &user, password()).await.is_err(),
            "the password alone signed in"
        );
        let other_key = sign_in(&remote, &user, password().with_security_key(key(8))).await;
        assert!(other_key.is_err(), "another key's PRF signed in");
        let both = sign_in(&remote, &user, password().with_security_key(key(7))).await?;
        assert!(both.rekey().await?.is_some());
        both.disconnect().await
    })
    .await
    .expect("a security key on a native server");
}
