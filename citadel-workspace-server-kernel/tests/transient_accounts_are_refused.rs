//! The production server refuses password-less (transient) accounts.
//!
//! Run against `run_server_with_base_path` itself, not a test node: the SDK
//! already proves that `allow_transient_connections: false` refuses one
//! (citadel_sdk/tests/rejections_reach_the_caller.rs), so the property to prove
//! here is that the server people deploy is built with it.
//!
//! A refusal alone proves nothing -- a server that is not listening refuses
//! everything too. So a credentialed registration against the same server must
//! SUCCEED first, and only then is a transient connection's failure evidence.

use citadel_sdk::prefabs::client::single_connection::SingleClientServerConnectionKernel;
use citadel_sdk::prefabs::client::ServerConnectionSettingsBuilder;
use citadel_sdk::prelude::*;
use common::production_server::start_production_server;
use std::time::Duration;

const MUST_ANSWER_WITHIN: Duration = Duration::from_secs(30);

#[derive(Debug)]
enum Outcome {
    /// The connection callback ran: the server accepted the session.
    Connected,
    /// The client gave up with an error before any session was established.
    Refused(NetworkError),
    /// Neither, within the budget.
    NoAnswer,
}

/// Whether the server let this client in. Decided by the connection callback
/// running, not by the client node exiting: the node keeps running after the
/// callback returns, so waiting for it measured nothing.
async fn attempt(settings: ServerConnectionSettings<StackedRatchet>) -> Outcome {
    let (connected_tx, connected_rx) = tokio::sync::oneshot::channel::<()>();
    let connected_tx = std::sync::Mutex::new(Some(connected_tx));
    let kernel = SingleClientServerConnectionKernel::new(settings, move |_conn| {
        if let Some(tx) = connected_tx.lock().unwrap().take() {
            let _ = tx.send(());
        }
        async move { Ok(()) }
    });
    let mut builder = DefaultNodeBuilder::default();
    // In memory: the SDK's client default is a filesystem store under ~/.citadel.
    let client = builder
        .with_backend(BackendType::InMemory)
        .with_insecure_skip_cert_verification()
        .build(kernel)
        .expect("client node");
    let client = tokio::spawn(client);
    tokio::select! {
        Ok(()) = connected_rx => Outcome::Connected,
        done = client => match done.expect("client task") {
            Err(err) => Outcome::Refused(err),
            Ok(_) => Outcome::NoAnswer,
        },
        _ = tokio::time::sleep(MUST_ANSWER_WITHIN) => Outcome::NoAnswer,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_production_server_refuses_a_transient_account() {
    citadel_logging::setup_log();
    let addr = start_production_server().await;

    let registered = attempt(
        ServerConnectionSettingsBuilder::credentialed_registration(
            addr,
            "realuser",
            "Real User",
            "password123",
        )
        .with_udp_mode(UdpMode::Disabled)
        .build()
        .expect("settings"),
    )
    .await;
    assert!(
        matches!(registered, Outcome::Connected),
        "a credentialed registration did not connect, so a transient refusal would prove nothing: {registered:?}"
    );

    let transient = attempt(
        ServerConnectionSettingsBuilder::transient(addr)
            .with_udp_mode(UdpMode::Disabled)
            .build()
            .expect("settings"),
    )
    .await;
    let Outcome::Refused(err) = transient else {
        panic!("the production server did not refuse a transient (password-less) account: {transient:?}");
    };
    // The server's reason, or the SDK's backstop when the teardown wins the race
    // to the wire -- the same two answers citadel_sdk's own test accepts. Anything
    // else is a refusal for some other reason, which proves nothing about this one.
    let message = err.into_string();
    assert!(
        message.contains("Transient connections are not allowed")
            || message.contains("The connection ended before the handshake completed"),
        "refused, but not for being transient: {message}"
    );
}
