//! Avarok's platform terms gate diagnostics only on a server whose users were shown them.
//!
//! No mocks: the real command processor and storage.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::resolve_require_platform_terms;
use citadel_workspace_types::telemetry::{TelemetryRequest, TelemetryResponse};
use common::telemetry_test_utils::{ask, hosted_kernel, member, refusal, telemetry};
use common::workspace_test_utils::{create_configured_test_kernel, create_test_kernel};

const ON: TelemetryRequest = TelemetryRequest::SetTelemetryConsent { enabled: true };

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_self_hosted_server_does_not_wait_for_terms_its_users_were_never_shown() {
    let kernel = create_configured_test_kernel(|k| k.set_platform_terms_required(false)).await;
    member(&kernel, "alice").await;
    match telemetry(ask(&kernel, "alice", ON).await) {
        TelemetryResponse::Consent(c) => assert!(c.terms_current && c.uploads_allowed, "{c:?}"),
        other => panic!("expected consent, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_hosted_tenant_waits_for_them() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    assert!(refusal(ask(&kernel, "alice", ON).await).contains("terms"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_server_not_told_either_way_answers_neither() {
    let kernel = create_test_kernel().await;
    member(&kernel, "alice").await;
    assert!(refusal(ask(&kernel, "alice", ON).await).contains("does not say"));
}

#[test]
fn a_config_that_does_not_say_is_an_error_not_a_default() {
    let config = |toml: &str| -> ServerConfig {
        toml::from_str(&format!("bind_addr = \"127.0.0.1:0\"\n{toml}")).expect("config")
    };
    assert!(resolve_require_platform_terms(&config("")).is_err());
    assert!(resolve_require_platform_terms(&config("require_platform_terms = true")).unwrap());
    assert!(!resolve_require_platform_terms(&config("require_platform_terms = false")).unwrap());
}
