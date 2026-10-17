//! Cloudflare Turnstile's answer, read by one rule: the port of the tenant worker's
//! `control/turnstile.mjs` `verdict` and `boundVerdict`. Pure; siteverify itself is reached
//! through [`SiteVerify`], the port a host supplies.
//!
//! The two implementations are held together by one fixture file both suites run
//! (deploy/tenant-worker/test/fixtures/turnstile-verdicts.json): the kernel's
//! `turnstile_verdicts_match_the_worker` test and scripts/lib/turnstile-verdict-parity.test.mjs.

use serde_json::Value;

/// Siteverify, as Cloudflare documents it.
pub const SITEVERIFY_URL: &str = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/// Siteverify could not be asked, or did not answer: the detail is logged, never shown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteVerifyUnreachable(pub String);

/// The way out to siteverify. `Ok` is its answer as JSON; a body that is not JSON is
/// `Value::Null` (as the worker's `response.json().catch(() => null)`), which no rule passes.
/// `remote_ip` is the client's address when the host knows a public one.
#[async_trait::async_trait]
pub trait SiteVerify: Send + Sync {
    async fn verify(
        &self,
        secret: &str,
        token: &str,
        remote_ip: Option<&str>,
    ) -> Result<Value, SiteVerifyUnreachable>;
}

/// How JS's `Array.prototype.join` renders one error code (siteverify sends strings).
fn code_text(code: &Value) -> String {
    match code {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Whether siteverify's `answer` lets this request through: success, solved on one of
/// `hostnames`, and -- when Cloudflare echoes an action, which it does for every widget that
/// sets `data-action` -- for `action`. `None` when it passes, else the refusal's detail.
pub fn verdict(answer: &Value, hostnames: &[String], action: &str) -> Option<String> {
    if !matches!(answer, Value::Object(_) | Value::Array(_)) {
        return Some("the Turnstile answer could not be read".to_string());
    }
    if answer.get("success") != Some(&Value::Bool(true)) {
        let codes = match answer.get("error-codes") {
            Some(Value::Array(codes)) => codes.iter().map(code_text).collect::<Vec<_>>().join(","),
            _ => String::new(),
        };
        return Some(if codes.is_empty() {
            "Turnstile did not pass this request".to_string()
        } else {
            format!("Turnstile did not pass this request: {codes}")
        });
    }
    let solved_here = match answer.get("hostname") {
        Some(Value::String(host)) => hostnames.iter().any(|allowed| allowed == host),
        _ => false,
    };
    if !solved_here {
        return Some("the Turnstile answer is for another site".to_string());
    }
    if let Some(Value::String(echoed)) = answer.get("action") {
        if !echoed.is_empty() && echoed != action {
            return Some("the Turnstile answer is for another action".to_string());
        }
    }
    None
}

/// `verdict`, for a token that must also have been rendered for `cdata` (the widget's `cData`),
/// so a token obtained for one workspace cannot be spent on another. An answer from
/// Cloudflare's TESTING keys carries no cdata (and says so in `metadata`); it is bound by the
/// secret and hostname alone. A real key's answer must carry it.
pub fn bound_verdict(
    answer: &Value,
    hostnames: &[String],
    action: &str,
    cdata: &str,
) -> Option<String> {
    if let Some(general) = verdict(answer, hostnames, action) {
        return Some(general);
    }
    let testing_key = answer
        .get("metadata")
        .and_then(|metadata| metadata.get("result_with_testing_key"))
        == Some(&Value::Bool(true));
    match answer.get("cdata") {
        None if testing_key => None,
        Some(Value::String(bound)) if bound == cdata => None,
        _ => Some("the Turnstile answer is for another workspace".to_string()),
    }
}
