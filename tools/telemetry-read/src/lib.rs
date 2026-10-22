//! `telemetry-read`: Avarok support's signed reads of a workspace's telemetry (plan section 3).
//!
//! ```text
//! telemetry-read keygen --private-key <new file>
//! telemetry-read list   --control <https://host> --private-key <file>
//! telemetry-read fetch  --control <https://host> --private-key <file> --tenant <slug> --limit <n>
//!                       [--offset <n>] [--user <id>] [--peer-cid <cid>] [--min-level warn|error]
//!                       [--since-ms <unix ms>] [--until-ms <unix ms>]
//! ```
//!
//! `keygen` writes a new ML-DSA-65 seed to the private key file (mode 0600, never over an existing
//! file; tools/release-sign's key-file handling) and prints only the public key, which is what
//! the control plane's `CITADEL_SUPPORT_MLDSA_PUBLIC_KEY` secret holds. `list` prints the tenants
//! whose admin has granted support access; `fetch` prints one tenant's telemetry as its kernel
//! answers `ListTelemetry`. Each request is signed with the private key (citadel-support-signature:
//! the control plane's host as its audience, a random nonce, valid for `REQUEST_LIFETIME_MS`). The
//! private key is read from the file, used to sign, and wiped; it is never printed or logged.
//!
//! This module parses and decides; main.rs does the file, clock, randomness and network I/O.

use citadel_support_signature::{SupportAction, SupportRequest, MAX_LIFETIME_MS, NONCE_LEN};
use citadel_workspace_types::telemetry::{
    TelemetryFilter, TelemetryLevel, TelemetryPage, MAX_TELEMETRY_PAGE_RECORDS,
};
use std::path::PathBuf;

pub use control_request::{control, Control};
use control_request::{number, Flags};

/// How long a request this tool signs stays valid: long enough for one round trip, well inside
/// the control plane's `MAX_LIFETIME_MS`.
pub const REQUEST_LIFETIME_MS: u64 = 60_000;
const _: () = assert!(REQUEST_LIFETIME_MS <= MAX_LIFETIME_MS);

pub const USAGE: &str = "usage:
  telemetry-read keygen --private-key <new file>
  telemetry-read list   --control <https://host> --private-key <file>
  telemetry-read fetch  --control <https://host> --private-key <file> --tenant <slug> --limit <n>
                        [--offset <n>] [--user <id>] [--peer-cid <cid>] [--min-level warn|error]
                        [--since-ms <unix ms>] [--until-ms <unix ms>]";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Keygen {
        private_key: PathBuf,
    },
    Read {
        control: Control,
        private_key: PathBuf,
        action: SupportAction,
    },
}

impl Command {
    /// The control-plane path a read is POSTed to.
    pub fn path(action: &SupportAction) -> &'static str {
        match action {
            SupportAction::ListGrants => "/api/support/grants",
            SupportAction::FetchTelemetry { .. } => "/api/support/telemetry",
        }
    }
}

/// The signed payload for `action`, made at `now_ms` with `nonce`.
pub fn request(
    control: &Control,
    action: SupportAction,
    nonce: &[u8; NONCE_LEN],
    now_ms: u64,
) -> SupportRequest {
    SupportRequest::new(
        &control.audience,
        action,
        nonce,
        now_ms,
        REQUEST_LIFETIME_MS,
    )
    .expect("REQUEST_LIFETIME_MS is within MAX_LIFETIME_MS")
}

pub fn parse(args: &[String]) -> Result<Command, String> {
    let (command, rest) = args.split_first().ok_or("no command")?;
    let mut flags = Flags::parse(rest, &[])?;
    let mut take = |flag: &str| flags.take(flag);
    let private_key = take("--private-key")
        .map(PathBuf::from)
        .ok_or_else(|| format!("{command} needs --private-key"))?;
    let parsed = match command.as_str() {
        "keygen" => Command::Keygen { private_key },
        "list" | "fetch" => {
            let control =
                control(&take("--control").ok_or_else(|| format!("{command} needs --control"))?)?;
            let action = if command == "list" {
                SupportAction::ListGrants
            } else {
                fetch(&mut take)?
            };
            Command::Read {
                control,
                private_key,
                action,
            }
        }
        other => return Err(format!("unknown command {other}")),
    };
    flags.finish(command)?;
    Ok(parsed)
}

fn fetch(take: &mut impl FnMut(&str) -> Option<String>) -> Result<SupportAction, String> {
    let tenant = take("--tenant").ok_or("fetch needs --tenant")?;
    let limit: u32 = number("--limit", &take("--limit").ok_or("fetch needs --limit")?)?;
    if limit == 0 || limit > MAX_TELEMETRY_PAGE_RECORDS {
        return Err(format!("--limit is 1 to {MAX_TELEMETRY_PAGE_RECORDS}"));
    }
    let optional = |value: Option<String>, flag: &str| -> Result<Option<u64>, String> {
        value.map(|v| number(flag, &v)).transpose()
    };
    let min_level = match take("--min-level").as_deref() {
        None => None,
        Some("warn") => Some(TelemetryLevel::Warn),
        Some("error") => Some(TelemetryLevel::Error),
        Some(other) => return Err(format!("--min-level {other:?} is warn or error")),
    };
    Ok(SupportAction::FetchTelemetry {
        tenant,
        filter: TelemetryFilter {
            user_id: take("--user"),
            peer_cid: optional(take("--peer-cid"), "--peer-cid")?,
            min_level,
            since_ms: optional(take("--since-ms"), "--since-ms")?,
            until_ms: optional(take("--until-ms"), "--until-ms")?,
        },
        page: TelemetryPage {
            // The first page unless one is named: the start of the list, not a hidden setting.
            offset: optional(take("--offset"), "--offset")?
                .map(u32::try_from)
                .transpose()
                .map_err(|_| "--offset is too large".to_string())?
                .unwrap_or(0),
            limit,
        },
    })
}

#[cfg(test)]
mod tests;
