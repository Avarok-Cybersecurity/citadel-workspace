//! The native server's Turnstile verdicts against the fixture the tenant worker's are held to
//! (deploy/tenant-worker/test/fixtures/turnstile-verdicts.json; the worker's side is
//! scripts/lib/turnstile-verdict-parity.test.mjs). A rule changed on one side only fails here or
//! there.
//!
//! Real: `bound_verdict` and `decide`, the code the native admission check runs. Siteverify is a
//! recording fake at the `SiteVerify` port -- it is Cloudflare's network service, the one thing
//! here a test must not reach.

use citadel_workspace_server_kernel::kernel::sign_in::admission::{
    decide, TurnstileCheck, TurnstileSecret,
};
use citadel_workspace_server_kernel::kernel::sign_in::turnstile::{
    bound_verdict, SiteVerify, SiteVerifyUnreachable,
};
use citadel_workspace_server_kernel::kernel::sign_in::{
    AdmissionChallenge, AdmissionKind, AdmissionProvider, AdmissionRefusal,
};
use serde_json::{json, Value};
use std::sync::Mutex;

fn fixture() -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../deploy/tenant-worker/test/fixtures/turnstile-verdicts.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("the shared fixture")).expect("JSON")
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("a list")
        .iter()
        .map(|v| v.as_str().expect("a string").to_string())
        .collect()
}

fn text(value: &Value, key: &str) -> String {
    value[key]
        .as_str()
        .unwrap_or_else(|| panic!("{key}"))
        .to_string()
}

/// Answers as the case's `siteverify` says, recording (secret, token, ip) for each call.
struct Fake {
    behaviour: Value,
    calls: Mutex<Vec<(String, String, Option<String>)>>,
}

#[async_trait::async_trait]
impl SiteVerify for Fake {
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
        self.calls.lock().unwrap().push(call);
        if self.behaviour["unreachable"] == json!(true) {
            return Err(SiteVerifyUnreachable("connect ECONNREFUSED".into()));
        }
        if self.behaviour["unreadable"] == json!(true) {
            return Ok(Value::Null);
        }
        Ok(self.behaviour["answer"].clone())
    }
}

/// The worker's answer shape for a refusal, so the expected values are compared as written.
fn as_worker_answer(result: Result<(), AdmissionRefusal>) -> Value {
    match result {
        Ok(()) => Value::Null,
        Err(AdmissionRefusal::Required(None)) => json!({ "refuse": "admission_required" }),
        Err(AdmissionRefusal::Required(Some(challenge))) => {
            json!({ "refuse": "admission_required", "challenge": challenge_json(&challenge) })
        }
        Err(AdmissionRefusal::Failed(reason)) => {
            json!({ "refuse": "admission_failed", "reason": reason })
        }
    }
}

/// The challenge as the worker writes it (admission.mjs `needsToken`).
fn challenge_json(challenge: &AdmissionChallenge) -> Value {
    let provider = match challenge.provider {
        AdmissionProvider::Turnstile => "turnstile",
    };
    json!({ "provider": provider, "site_key": challenge.site_key, "identity": challenge.identity })
}

fn token_of(case: &Value) -> Option<String> {
    if let Some(repeat) = case.get("token_repeat") {
        let unit = repeat[0].as_str().expect("unit");
        return Some(unit.repeat(repeat[1].as_u64().expect("count") as usize));
    }
    case["token"].as_str().map(str::to_string)
}

#[test]
fn bound_verdict_answers_every_case_as_the_worker_does() {
    let fixture = fixture();
    let check = &fixture["check"];
    let cases = fixture["bound_verdict"].as_array().expect("cases");
    assert!(cases.len() >= 10, "the fixture lost its cases");
    for case in cases {
        let got = bound_verdict(
            &case["answer"],
            &strings(&check["hostnames"]),
            &text(case, "action"),
            &text(check, "cdata"),
        );
        assert_eq!(
            got.as_deref(),
            case["expected"].as_str(),
            "{}",
            case["name"]
        );
    }
}

#[tokio::test]
async fn admission_answers_every_case_as_the_worker_does() {
    let fixture = fixture();
    let check = &fixture["check"];
    let ip = text(&fixture, "ip");
    let turnstile = TurnstileCheck {
        secret: TurnstileSecret::new(text(check, "secret")),
        site_key: text(check, "site_key"),
        hostnames: strings(&check["hostnames"]),
        cdata: text(check, "cdata"),
    };
    let cases = fixture["admit"].as_array().expect("cases");
    assert!(cases.len() >= 10, "the fixture lost its cases");
    for case in cases {
        let fake = Fake {
            behaviour: case["siteverify"].clone(),
            calls: Mutex::new(Vec::new()),
        };
        let kind = match case["kind"].as_str() {
            Some("SignIn") => AdmissionKind::SignIn,
            Some("Register") => AdmissionKind::Register,
            other => panic!("kind {other:?}"),
        };
        let token = token_of(case);
        let required = case["required"].as_bool().expect("required");
        let got = decide(
            required,
            &turnstile,
            &fake,
            kind,
            token.as_deref(),
            Some(&ip),
        )
        .await;
        assert_eq!(as_worker_answer(got), case["expected"], "{}", case["name"]);
        let expected_calls = if case["asked"] == json!(true) {
            vec![(
                text(check, "secret"),
                token.expect("asked with a token"),
                Some(ip.clone()),
            )]
        } else {
            vec![]
        };
        assert_eq!(
            *fake.calls.lock().unwrap(),
            expected_calls,
            "{}",
            case["name"]
        );
    }
}
