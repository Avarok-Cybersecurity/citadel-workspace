//! The admin's "require a human check" switch on a native server: kept in its settings file,
//! read by the admission check, and impossible to turn on where nothing would enforce it.
//!
//! Real: the kernel's `UpdateSignInSettings` / `GetSignInSettings`, the native settings stores
//! and `TurnstileAdmission`. Siteverify is a recording fake at the `SiteVerify` port (it is
//! Cloudflare's service); here it must never be asked.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::kernel::sign_in::admission::{
    TurnstileAdmission, TurnstileCheck, TurnstileSecret, UnenforcedSignInSettings,
    CHECK_UNAVAILABLE, NOTHING_ENFORCES_IT, RESUME_GRACE,
};
use citadel_workspace_server_kernel::kernel::sign_in::native::settings_file::FileSignInSettings;
use citadel_workspace_server_kernel::kernel::sign_in::turnstile::{
    SiteVerify, SiteVerifyUnreachable,
};
use citadel_workspace_server_kernel::kernel::sign_in::{
    AdmissionChallenge, AdmissionContext, AdmissionKind, AdmissionPolicy, AdmissionRefusal,
    SignInSettingsStore, SignInSettingsUnavailable,
};
use citadel_workspace_types::sign_in::SignInSettings;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::workspace_test_utils::{create_configured_test_kernel, TEST_ADMIN_USER_ID};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const ON: SignInSettings = SignInSettings {
    require_turnstile_sign_in: true,
};
const OFF: SignInSettings = SignInSettings {
    require_turnstile_sign_in: false,
};

async fn update(
    store: Arc<dyn SignInSettingsStore>,
    settings: SignInSettings,
) -> WorkspaceProtocolResponse {
    let kernel = create_configured_test_kernel(|k| k.set_sign_in_settings(Some(store))).await;
    let request = WorkspaceProtocolRequest::UpdateSignInSettings { settings };
    process_command_with_user(&kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .expect("dispatch")
}

#[tokio::test]
async fn with_admission_none_the_switch_cannot_be_turned_on() {
    match update(Arc::new(UnenforcedSignInSettings), ON).await {
        WorkspaceProtocolResponse::Error(message) => {
            assert!(message.contains(NOTHING_ENFORCES_IT), "{message}")
        }
        other => panic!("an unenforced switch was turned on: {other:?}"),
    }
    match update(Arc::new(UnenforcedSignInSettings), OFF).await {
        WorkspaceProtocolResponse::SignInSettings(settings) => assert_eq!(settings, OFF),
        other => panic!("turning it off was refused: {other:?}"),
    }
}

#[tokio::test]
async fn the_file_keeps_what_an_admin_set_across_a_restart() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("settings.json");
    let store = Arc::new(FileSignInSettings::open(&path).expect("no file yet"));
    assert_eq!(
        store.load().await.unwrap(),
        OFF,
        "a new server's switch is off"
    );
    match update(store, ON).await {
        WorkspaceProtocolResponse::SignInSettings(settings) => assert_eq!(settings, ON),
        other => panic!("refused: {other:?}"),
    }
    let restarted = FileSignInSettings::open(&path).expect("reopens");
    assert_eq!(
        restarted.load().await.unwrap(),
        ON,
        "the switch did not survive a restart"
    );
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        r#"{"require_turnstile_sign_in":true}"#
    );
}

#[test]
fn a_file_with_no_directory_or_bad_json_stops_the_server() {
    assert!(
        FileSignInSettings::open(std::path::Path::new("/nonexistent-dir/settings.json")).is_err()
    );
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("settings.json");
    std::fs::write(&path, "{}").unwrap();
    assert!(
        FileSignInSettings::open(&path).is_err(),
        "a file without the field read as off"
    );
}

#[derive(Default)]
struct Recording(Mutex<Vec<String>>);

#[async_trait::async_trait]
impl SiteVerify for Recording {
    async fn verify(
        &self,
        _: &str,
        token: &str,
        _: Option<&str>,
    ) -> Result<serde_json::Value, SiteVerifyUnreachable> {
        self.0.lock().unwrap().push(token.to_string());
        Ok(serde_json::json!({ "success": true, "hostname": "example.com", "cdata": "acme" }))
    }
}

struct Fixed(Result<SignInSettings, SignInSettingsUnavailable>);

#[async_trait::async_trait]
impl SignInSettingsStore for Fixed {
    async fn load(&self) -> Result<SignInSettings, SignInSettingsUnavailable> {
        self.0.clone()
    }
    async fn store(&self, _: SignInSettings) -> Result<(), SignInSettingsUnavailable> {
        unreachable!("the check never writes the settings")
    }
}

fn policy(
    settings: Result<SignInSettings, SignInSettingsUnavailable>,
    seen: Arc<Recording>,
) -> TurnstileAdmission {
    let check = TurnstileCheck {
        secret: TurnstileSecret::new("a-secret".into()),
        site_key: "a-site-key".into(),
        hostnames: vec!["example.com".into()],
        cdata: "acme".into(),
    };
    TurnstileAdmission::new(check, seen, Arc::new(Fixed(settings)))
}

fn ctx(token: Option<&str>) -> AdmissionContext {
    AdmissionContext {
        username: "alice".into(),
        kind: AdmissionKind::SignIn,
        token: token.map(citadel_workspace_server_kernel::kernel::sign_in::AdmissionToken::new),
        remote_addr: Some("127.0.0.1".parse().unwrap()),
    }
}

#[tokio::test]
async fn the_check_reads_the_switch_and_fails_closed_when_it_cannot() {
    let seen = Arc::new(Recording::default());
    assert_eq!(policy(Ok(OFF), seen.clone()).admit(ctx(None)).await, Ok(()));
    assert_eq!(
        policy(Ok(ON), seen.clone()).admit(ctx(None)).await,
        Err(AdmissionRefusal::Required(Some(
            AdmissionChallenge::turnstile("a-site-key", Some("acme".into()))
        )))
    );
    assert!(
        seen.0.lock().unwrap().is_empty(),
        "siteverify was asked without a token"
    );
    assert_eq!(
        policy(Ok(ON), seen.clone()).admit(ctx(Some("t"))).await,
        Ok(())
    );
    let unreadable = Err(SignInSettingsUnavailable("disk".into()));
    assert_eq!(
        policy(unreadable, seen.clone()).admit(ctx(Some("t"))).await,
        Err(AdmissionRefusal::Failed(CHECK_UNAVAILABLE.into()))
    );
    assert_eq!(*seen.0.lock().unwrap(), ["t"]);
    assert_eq!(
        policy(Ok(ON), seen).resume_grace(),
        Duration::from_secs(900)
    );
    assert_eq!(RESUME_GRACE, Duration::from_secs(900));
}
