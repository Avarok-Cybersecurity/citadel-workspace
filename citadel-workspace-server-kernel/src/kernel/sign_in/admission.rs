//! The admission check a fresh sign-in or registration passes on a server that asks for a
//! Turnstile token: the port of the tenant worker's `control/admission.mjs` `admit`, over the
//! [`SiteVerify`] port and the workspace's [`SignInSettingsStore`].
//!
//! It fails CLOSED: with the setting on, no token, a token siteverify refuses, a siteverify that
//! cannot be reached and settings that cannot be read are all refusals. With the setting off it
//! admits and asks no one.

use super::turnstile::{bound_verdict, SiteVerify};
use super::{AdmissionContext, AdmissionKind, AdmissionPolicy, AdmissionRefusal};
use super::{SignInSettingsStore, SignInSettingsUnavailable};
use citadel_workspace_types::sign_in::SignInSettings;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

/// Said to the client when the check could not be completed; the detail goes to the log only.
pub const CHECK_UNAVAILABLE: &str = "the check could not be completed";

/// Turnstile tokens are at most 2048 characters (as control/tenants.mjs bounds them), counted as
/// JS counts a string's length: UTF-16 code units.
pub const MAX_TOKEN_CHARS: usize = 2048;

/// How long after a session ends its client's reconnect is still not asked the check: the
/// agent retries a dropped session for 600 s (`SERVER_RECONNECT.give_up_after` in
/// citadel-internal-service), and its last attempt may take 30 s more to reach the check
/// (`attempt_timeout`) after up to 30 s of backoff. 900 s covers that with five minutes
/// spare for the gap between the server ending the session and the agent seeing the drop.
/// It exempts only from the check; the reconnect still proves the password, and each
/// ended session's token is honoured once, for its own account.
pub const RESUME_GRACE: Duration = Duration::from_secs(900);

/// The secret siteverify is asked with. Never printed.
#[derive(Clone)]
pub struct TurnstileSecret(String);

impl TurnstileSecret {
    pub fn new(secret: String) -> Self {
        Self(secret)
    }
}

impl std::fmt::Debug for TurnstileSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TurnstileSecret(..)")
    }
}

/// What a token must have been obtained for: the configured secret's widget, solved on one of
/// `hostnames`, rendered with `cdata` (the worker binds the tenant's slug).
#[derive(Clone, Debug)]
pub struct TurnstileCheck {
    pub secret: TurnstileSecret,
    pub hostnames: Vec<String>,
    pub cdata: String,
}

fn failed(reason: &str) -> AdmissionRefusal {
    AdmissionRefusal::Failed(reason.to_string())
}

/// The client address siteverify is told, when there is one worth telling: a loopback or
/// private address is a proxy's (a tunnel in front of the server), not the visitor's.
pub fn public_ip(addr: Option<IpAddr>) -> Option<String> {
    let addr = match addr? {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(IpAddr::V6(v6), IpAddr::V4),
        v4 => v4,
    };
    let private = match addr {
        IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
        }
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
        }
    };
    (!private).then(|| addr.to_string())
}

/// The verdict for one admission, with the setting as `required`: `admit` in admission.mjs.
pub async fn decide(
    required: bool,
    check: &TurnstileCheck,
    verifier: &dyn SiteVerify,
    kind: AdmissionKind,
    token: Option<&str>,
    remote_ip: Option<&str>,
) -> Result<(), AdmissionRefusal> {
    if !required {
        return Ok(());
    }
    let token = match token {
        Some(token) if !token.is_empty() => token,
        _ => return Err(AdmissionRefusal::Required),
    };
    if token.encode_utf16().count() > MAX_TOKEN_CHARS {
        return Err(failed("the check's token is malformed"));
    }
    match verifier.verify(&check.secret.0, token, remote_ip).await {
        Ok(answer) => match bound_verdict(&answer, &check.hostnames, kind.action(), &check.cdata) {
            None => Ok(()),
            Some(detail) => Err(AdmissionRefusal::Failed(detail)),
        },
        Err(unreachable) => {
            log::error!(target: "citadel", "admission: siteverify could not be reached: {}", unreachable.0);
            Err(failed(CHECK_UNAVAILABLE))
        }
    }
}

/// The admission check over Turnstile, asking the workspace's settings whether it is on.
pub struct TurnstileAdmission {
    check: TurnstileCheck,
    verifier: Arc<dyn SiteVerify>,
    settings: Arc<dyn SignInSettingsStore>,
}

impl TurnstileAdmission {
    pub fn new(
        check: TurnstileCheck,
        verifier: Arc<dyn SiteVerify>,
        settings: Arc<dyn SignInSettingsStore>,
    ) -> Self {
        Self {
            check,
            verifier,
            settings,
        }
    }
}

#[async_trait::async_trait]
impl AdmissionPolicy for TurnstileAdmission {
    async fn admit(&self, ctx: AdmissionContext) -> Result<(), AdmissionRefusal> {
        let required = match self.settings.load().await {
            Ok(settings) => settings.require_turnstile_sign_in,
            Err(SignInSettingsUnavailable(detail)) => {
                log::error!(target: "citadel", "admission: the sign-in settings could not be read: {detail}");
                return Err(failed(CHECK_UNAVAILABLE));
            }
        };
        let token = ctx.token.as_ref().map(|token| token.as_str());
        let remote_ip = public_ip(ctx.remote_addr);
        decide(
            required,
            &self.check,
            self.verifier.as_ref(),
            ctx.kind,
            token,
            remote_ip.as_deref(),
        )
        .await
    }

    fn resume_grace(&self) -> Duration {
        RESUME_GRACE
    }
}

/// Refused when a server with no human check is asked to require one.
pub const NOTHING_ENFORCES_IT: &str = "this server has no human check configured \
     (kernel.toml [sign_in] admission = \"none\"), so it cannot require one";

/// The sign-in settings of a server configured with `admission = "none"`: the setting is off and
/// cannot be turned on, because nothing would enforce it -- a switch nothing enforces would claim
/// a protection that is not there.
pub struct UnenforcedSignInSettings;

const OFF: SignInSettings = SignInSettings {
    require_turnstile_sign_in: false,
};

#[async_trait::async_trait]
impl SignInSettingsStore for UnenforcedSignInSettings {
    async fn load(&self) -> Result<SignInSettings, SignInSettingsUnavailable> {
        Ok(OFF)
    }

    async fn store(&self, settings: SignInSettings) -> Result<(), SignInSettingsUnavailable> {
        if settings.require_turnstile_sign_in {
            return Err(SignInSettingsUnavailable(NOTHING_ENFORCES_IT.to_string()));
        }
        Ok(())
    }
}
