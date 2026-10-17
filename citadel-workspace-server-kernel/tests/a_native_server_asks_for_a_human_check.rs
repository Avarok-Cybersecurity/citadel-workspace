//! A self-hosted server configured with `admission = "turnstile"` asks every fresh registration
//! and sign-in for a Turnstile token while its admin's switch is on, and asks nobody while it is
//! off.
//!
//! Real: `run_server_with_site_verify` (what `run_server_with_base_path` runs), its kernel.toml
//! `[sign_in]`, the seed and settings files, the SDK's admission hook and the verdict rule.
//! Siteverify is a recording fake at the `SiteVerify` port, because it is Cloudflare's service
//! and a test must not reach it; what each token "solves" is decided by the token's name.

use citadel_io::ErrorCode;
use citadel_sdk::prelude::*;
use citadel_workspace_server_kernel::kernel::sign_in::admission::CHECK_UNAVAILABLE;
use citadel_workspace_server_kernel::kernel::sign_in::turnstile::{
    SiteVerify, SiteVerifyUnreachable,
};
use common::production_server::{sign_in_dir, start_native_server};
use common::sign_in_client::{drive, sign_in, username, PASSWORD};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Unique to this test binary; set before any server reads it, and holding no real secret.
const SECRET_ENV: &str = "CITADEL_NATIVE_TURNSTILE_TEST_SECRET";
const SECRET: &str = "1x0000000000000000000000000000000AA";

#[derive(Default)]
struct Siteverify {
    asked: Mutex<Vec<(String, String, Option<String>)>>,
}

#[async_trait::async_trait]
impl SiteVerify for Siteverify {
    async fn verify(
        &self,
        secret: &str,
        token: &str,
        remote_ip: Option<&str>,
    ) -> Result<Value, SiteVerifyUnreachable> {
        let call = (
            secret.to_string(),
            token.to_string(),
            remote_ip.map(str::to_string),
        );
        self.asked.lock().unwrap().push(call);
        match token {
            "pass" => Ok(json!({ "success": true, "hostname": "example.com", "cdata": "acme" })),
            "for-register" => Ok(json!({
                "success": true, "hostname": "example.com", "cdata": "acme", "action": "register"
            })),
            "elsewhere" => {
                Ok(json!({ "success": true, "hostname": "evil.example", "cdata": "acme" }))
            }
            "down" => Err(SiteVerifyUnreachable("connect ECONNREFUSED".into())),
            _ => Ok(json!({ "success": false, "error-codes": ["invalid-input-response"] })),
        }
    }
}

impl Siteverify {
    fn tokens(&self) -> Vec<String> {
        let asked = self.asked.lock().unwrap();
        assert!(
            asked
                .iter()
                .all(|(secret, _, ip)| secret == SECRET && ip.is_none()),
            "siteverify was asked with another secret, or told a loopback address: {asked:?}"
        );
        asked.iter().map(|(_, token, _)| token.clone()).collect()
    }
}

/// A server whose admin's switch is `required`, asking `siteverify`.
async fn server(required: bool, siteverify: Arc<Siteverify>) -> std::net::SocketAddr {
    std::env::set_var(SECRET_ENV, SECRET);
    let dir = sign_in_dir();
    let settings = dir.join("settings.json");
    let stored = json!({ "require_turnstile_sign_in": required }).to_string();
    std::fs::write(&settings, stored).expect("settings");
    start_native_server(&turnstile_config(&dir, &settings), Some(siteverify)).await
}

fn turnstile_config(dir: &Path, settings: &Path) -> String {
    format!(
        "[sign_in]\noprf_seed_file = \"{}\"\nksf = \"owasp-floor\"\nadmission = \"turnstile\"\n\
         turnstile_secret_env = \"{SECRET_ENV}\"\nturnstile_hostnames = [\"example.com\"]\n\
         turnstile_cdata = \"acme\"\nsettings_file = \"{}\"\n",
        dir.join("oprf-seed").display(),
        settings.display()
    )
}

fn code<T>(result: &Result<T, NetworkError>) -> Option<ErrorCode> {
    result.as_ref().err().map(|err| err.code)
}

fn reason<T>(result: Result<T, NetworkError>) -> String {
    result
        .err()
        .map(NetworkError::into_string)
        .unwrap_or_default()
}

async fn register(
    remote: &NodeRemote<StackedRatchet>,
    addr: std::net::SocketAddr,
    user: &str,
    token: Option<&str>,
) -> Result<RegisterSuccess, NetworkError> {
    let admission = token.map(str::to_string);
    remote
        .register_admitted(
            addr,
            user,
            user,
            PASSWORD,
            Default::default(),
            None,
            admission,
        )
        .await
}

fn password() -> SignInFactors {
    SignInFactors::password(PASSWORD)
}

#[tokio::test(flavor = "multi_thread")]
async fn with_the_switch_on_only_a_good_token_is_admitted() {
    citadel_logging::setup_log();
    let siteverify = Arc::new(Siteverify::default());
    let addr = server(true, siteverify.clone()).await;
    let user = username("human");
    let seen = siteverify.clone();
    drive(move |remote| async move {
        let missing = register(&remote, addr, &user, None).await;
        assert_eq!(
            code(&missing),
            Some(ErrorCode::PqSignInAdmissionRequired),
            "{:?}",
            missing.as_ref().err()
        );
        assert!(
            seen.tokens().is_empty(),
            "siteverify was asked about no token"
        );

        let elsewhere = register(&remote, addr, &user, Some("elsewhere")).await;
        assert_eq!(code(&elsewhere), Some(ErrorCode::PqSignInAdmissionFailed));
        assert!(reason(elsewhere).contains("another site"));
        let down = register(&remote, addr, &user, Some("down")).await;
        assert_eq!(code(&down), Some(ErrorCode::PqSignInAdmissionFailed));
        assert!(reason(down).contains(CHECK_UNAVAILABLE));
        let registered = register(&remote, addr, &user, Some("pass")).await?;
        assert_eq!(
            registered.recovery_codes.len(),
            10,
            "not a post-quantum account"
        );

        let missing = sign_in(&remote, &user, password()).await;
        assert_eq!(code(&missing), Some(ErrorCode::PqSignInAdmissionRequired));
        let other_action = sign_in(&remote, &user, password().with_admission("for-register")).await;
        assert_eq!(
            code(&other_action),
            Some(ErrorCode::PqSignInAdmissionFailed)
        );
        assert!(reason(other_action).contains("another action"));
        let conn = sign_in(&remote, &user, password().with_admission("pass")).await?;
        assert!(conn.rekey().await?.is_some());
        assert_eq!(
            seen.tokens(),
            ["elsewhere", "down", "pass", "for-register", "pass"]
        );
        conn.disconnect().await
    })
    .await
    .expect("the human check");
}

#[tokio::test(flavor = "multi_thread")]
async fn with_the_switch_off_nobody_is_asked() {
    citadel_logging::setup_log();
    let siteverify = Arc::new(Siteverify::default());
    let addr = server(false, siteverify.clone()).await;
    let user = username("nocheck");
    drive(move |remote| async move {
        let registered = register(&remote, addr, &user, None).await?;
        assert_eq!(registered.recovery_codes.len(), 10);
        let conn = sign_in(&remote, &user, password()).await?;
        conn.disconnect().await
    })
    .await
    .expect("no check while the switch is off");
    assert!(
        siteverify.tokens().is_empty(),
        "siteverify was asked while the switch was off"
    );
}
