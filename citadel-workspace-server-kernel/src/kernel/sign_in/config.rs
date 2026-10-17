//! kernel.toml's `[sign_in]`: how a native server offers post-quantum sign-in and whether it asks
//! fresh sign-ins and registrations for a Turnstile token. Required by the native server, and
//! refused by a hosted one, whose host supplies all of it (`HostedSignIn`). No key has a default.
//!
//! ```toml
//! [sign_in]
//! oprf_seed_file = "/data/server/sign-in/oprf-seed"   # made by --init-sign-in-seed, mode 0600
//! ksf = "owasp-floor"            # or ksf_mem_kib / ksf_iterations / ksf_lanes, all three
//! admission = "none"             # or "turnstile", with the five keys below
//! # turnstile_secret_env = "TURNSTILE_SECRET"   # the NAME of the variable holding the secret
//! # turnstile_site_key = "0x4AAAAAAA..."        # the widget's PUBLIC site key
//! # turnstile_hostnames = ["work.example.com"]  # where the widget may be solved
//! # turnstile_cdata = "work-example"            # the widget's cData: this server's identity
//! # settings_file = "/data/server/sign-in/settings.json"  # the admin's "require" switch
//! ```
//!
//! `turnstile_cdata` is what the hosted worker binds to a tenant's slug: a token whose answer
//! carries another cData was obtained for another workspace and is refused. Cloudflare allows
//! 1 to 255 of `A-Z a-z 0-9 _ -` there, so a hostname (with its dots) cannot be one.
//!
//! `turnstile_site_key` is PUBLIC (Cloudflare hands it to every visitor) and so may be written
//! inline. The server publishes it, with `turnstile_cdata`, on each `admission_required`
//! refusal: a window reaching this server only through its agent has no HTTP discovery to ask.

use super::pq::ksf_preset;
use super::KsfParams;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AdmissionMode {
    None,
    Turnstile,
}

/// `[sign_in]` as written. It names no secret, only the variable that holds one.
#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct NativeSignInConfig {
    pub oprf_seed_file: Option<String>,
    pub ksf: Option<String>,
    pub ksf_mem_kib: Option<u32>,
    pub ksf_iterations: Option<u32>,
    pub ksf_lanes: Option<u32>,
    pub admission: Option<AdmissionMode>,
    pub turnstile_secret_env: Option<String>,
    pub turnstile_site_key: Option<String>,
    pub turnstile_hostnames: Option<Vec<String>>,
    pub turnstile_cdata: Option<String>,
    pub settings_file: Option<String>,
}

/// What a Turnstile-checking server reads at startup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnstilePlan {
    pub secret_env: String,
    pub site_key: String,
    pub hostnames: Vec<String>,
    pub cdata: String,
    pub settings_file: PathBuf,
}

/// `[sign_in]`, checked: every key there, every value usable. Nothing read yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignInPlan {
    pub seed_file: PathBuf,
    pub ksf: KsfParams,
    pub turnstile: Option<TurnstilePlan>,
}

fn absolute(key: &str, value: Option<&String>) -> Result<PathBuf, String> {
    let value = value.ok_or_else(|| format!("[sign_in] {key} is required"))?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!(
            "[sign_in] {key} must be an absolute path, got {value:?}"
        ));
    }
    Ok(path)
}

fn ksf(config: &NativeSignInConfig) -> Result<KsfParams, String> {
    let numbers = (config.ksf_mem_kib, config.ksf_iterations, config.ksf_lanes);
    let params = match (&config.ksf, numbers) {
        (Some(name), (None, None, None)) => ksf_preset(name).ok_or_else(|| {
            format!("[sign_in] ksf {name:?} is not a preset; the one preset is \"owasp-floor\"")
        })?,
        (None, (Some(mem_kib), Some(iterations), Some(lanes))) => KsfParams {
            mem_kib,
            iterations,
            lanes,
        },
        _ => {
            return Err(
                "[sign_in] needs exactly one of ksf = \"owasp-floor\" or all three of \
                 ksf_mem_kib, ksf_iterations and ksf_lanes"
                    .to_string(),
            )
        }
    };
    if !params.meets_floor() {
        return Err(format!(
            "[sign_in] the Argon2id cost {params:?} is below the floor clients accept ({:?})",
            KsfParams::FLOOR
        ));
    }
    Ok(params)
}

fn env_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(|c: char| c.is_ascii_digit())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn cdata(value: &str) -> bool {
    (1..=255).contains(&value.len())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn site_key(value: &str) -> bool {
    cdata(value)
}

fn hostname(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

fn turnstile(config: &NativeSignInConfig) -> Result<TurnstilePlan, String> {
    let secret_env = config
        .turnstile_secret_env
        .clone()
        .filter(|name| env_name(name))
        .ok_or("[sign_in] turnstile_secret_env must name the environment variable that holds the Turnstile secret")?;
    let site_key = config
        .turnstile_site_key
        .clone()
        .filter(|key| site_key(key))
        .ok_or("[sign_in] turnstile_site_key must be the widget's public site key (1 to 255 of A-Z a-z 0-9 _ -)")?;
    let hostnames = config
        .turnstile_hostnames
        .clone()
        .filter(|hosts| !hosts.is_empty() && hosts.iter().all(|h| hostname(h)))
        .ok_or("[sign_in] turnstile_hostnames must list the hostnames the widget is solved on")?;
    let cdata = config
        .turnstile_cdata
        .clone()
        .filter(|value| cdata(value))
        .ok_or(
            "[sign_in] turnstile_cdata must be 1 to 255 of A-Z a-z 0-9 _ - (the widget's cData)",
        )?;
    let settings_file = absolute("settings_file", config.settings_file.as_ref())?;
    Ok(TurnstilePlan {
        secret_env,
        site_key,
        hostnames,
        cdata,
        settings_file,
    })
}

/// The plan `config` describes, or the first thing wrong with it. `None` is a kernel.toml with
/// no `[sign_in]` at all.
pub fn plan(config: Option<&NativeSignInConfig>) -> Result<SignInPlan, String> {
    let config = config.ok_or(
        "kernel.toml has no [sign_in] section; a native server must say how people sign in \
         (oprf_seed_file, ksf and admission -- see docker/workspace-server/kernel.toml)",
    )?;
    let seed_file = absolute("oprf_seed_file", config.oprf_seed_file.as_ref())?;
    let ksf = ksf(config)?;
    let turnstile = match config.admission {
        None => return Err("[sign_in] admission is required: \"none\" or \"turnstile\"".into()),
        Some(AdmissionMode::Turnstile) => Some(turnstile(config)?),
        Some(AdmissionMode::None) => {
            let stray = [
                (
                    "turnstile_secret_env",
                    config.turnstile_secret_env.is_some(),
                ),
                ("turnstile_site_key", config.turnstile_site_key.is_some()),
                ("turnstile_hostnames", config.turnstile_hostnames.is_some()),
                ("turnstile_cdata", config.turnstile_cdata.is_some()),
                ("settings_file", config.settings_file.is_some()),
            ];
            if let Some((key, _)) = stray.iter().find(|(_, set)| *set) {
                return Err(format!(
                    "[sign_in] {key} is set but admission = \"none\": nothing would read it"
                ));
            }
            None
        }
    };
    Ok(SignInPlan {
        seed_file,
        ksf,
        turnstile,
    })
}
