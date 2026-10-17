//! Sign-in on a native (self-hosted) server: what kernel.toml's `[sign_in]` describes, read and
//! built into the same [`HostedSignIn`] a Durable Object hands a hosted node. Post-quantum sign-in
//! is always on; the Turnstile check is on unless the operator wrote `admission = "none"`.
//!
//! What is read here is the server's I/O, and only at startup: the seed file, the settings file
//! and the environment variable holding the Turnstile secret. Siteverify is the caller's
//! [`SiteVerify`], so the check can be driven without Cloudflare.

pub mod seed_file;
pub mod settings_file;
pub mod siteverify;

use super::admission::{
    TurnstileAdmission, TurnstileCheck, TurnstileSecret, UnenforcedSignInSettings,
};
use super::config::{plan, NativeSignInConfig};
use super::pq::pq_sign_in_settings;
use super::turnstile::SiteVerify;
use super::HostedSignIn;
use std::sync::Arc;

pub use seed_file::{init_sign_in_seed, read_seed};

/// The sign-in a native server starts with, or the first reason it cannot start. `env` reads an
/// environment variable (`std::env::var`, in production).
pub fn native_sign_in(
    config: Option<&NativeSignInConfig>,
    env: &dyn Fn(&str) -> Option<String>,
    site_verify: Arc<dyn SiteVerify>,
) -> Result<HostedSignIn, String> {
    let plan = plan(config)?;
    let seed = read_seed(&plan.seed_file)?;
    let pq = pq_sign_in_settings(seed.as_ref(), plan.ksf)?;
    let Some(turnstile) = plan.turnstile else {
        log::warn!(target: "citadel", "Sign-in: post-quantum, with no human check (admission = \"none\"); the admin's \"require a human check\" switch stays off");
        return Ok(HostedSignIn {
            pq_sign_in: Some(pq),
            admission: None,
            settings: Some(Arc::new(UnenforcedSignInSettings)),
        });
    };
    let secret = env(&turnstile.secret_env)
        .filter(|secret| !secret.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "[sign_in] turnstile_secret_env names {}, which is not set (or is empty)",
                turnstile.secret_env
            )
        })?;
    let settings: Arc<dyn super::SignInSettingsStore> = Arc::new(
        settings_file::FileSignInSettings::open(&turnstile.settings_file)?,
    );
    let check = TurnstileCheck {
        secret: TurnstileSecret::new(secret),
        hostnames: turnstile.hostnames,
        cdata: turnstile.cdata,
    };
    log::info!(target: "citadel", "Sign-in: post-quantum, with a Turnstile check for {:?} when an admin requires one", check.hostnames);
    Ok(HostedSignIn {
        pq_sign_in: Some(pq),
        admission: Some(Arc::new(TurnstileAdmission::new(
            check,
            site_verify,
            settings.clone(),
        ))),
        settings: Some(settings),
    })
}
