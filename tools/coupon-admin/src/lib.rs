//! `coupon-admin`: the owner's signed requests to issue, revoke and list dynamic coupons
//! (`docs/plans/citadel-apps-and-coupons-design.md` 1.6, revision 2 R1).
//!
//! `keygen` writes a new ML-DSA-65 seed to the private key file (mode 0600, never over an existing
//! file; tools/release-sign's key-file handling) and prints only the public key, which is what
//! the control plane's `CITADEL_ADMIN_MLDSA_PUBLIC_KEY` secret holds. Every other command signs
//! one `AdminRequest` (citadel-support-signature's admin domain: the control plane's host as its
//! audience, a random nonce, valid for `REQUEST_LIFETIME_MS`) and POSTs it to the origin given
//! with `--control`; there is no default. The private key is read, used to sign, and wiped; it is
//! never printed or logged.
//!
//! `issue` prints what the coupon will do, which platform ceilings still bind it and what relay
//! it can cost (`confirm.rs`), and sends nothing without `--yes`. A grant needs
//! `--max-redemptions` and `--redeem-by`: it may be unlimited, and those two bound a leaked code.
//!
//! This module parses and decides; main.rs does the file, clock, randomness and network I/O.

mod confirm;
mod issue;

use citadel_support_signature::{
    AdminAction, AdminRequest, SignedAdminRequest, MAX_LIFETIME_MS, MAX_PAYLOAD_BYTES, NONCE_LEN,
};
use control_request::Flags;
use std::path::PathBuf;

pub use confirm::{confirmation, preflight};
pub use control_request::{control, Control};

/// How long a request this tool signs stays valid: long enough for one round trip, well inside
/// the control plane's `MAX_LIFETIME_MS`.
pub const REQUEST_LIFETIME_MS: u64 = 60_000;
const _: () = assert!(REQUEST_LIFETIME_MS <= MAX_LIFETIME_MS);

pub const USAGE: &str = "usage:
  coupon-admin keygen      --private-key <new file>
  coupon-admin issue       --control <https://host> --private-key <file> --code <CODE>
                           (--template <id> | --grant <id>) --available-on <tier,...>
                           --intervals <month,year> --max-redemptions <n>
                           [--redeem-by <unix ms>] --note <text> [--yes]
                           (a grant requires --redeem-by)
  coupon-admin revoke      --control <https://host> --private-key <file> --code <CODE>
                           --also-revoke-grants yes|no
  coupon-admin list        --control <https://host> --private-key <file>
  coupon-admin redemptions --control <https://host> --private-key <file> --code <CODE>";

// One value per run, parsed once: boxing the larger variant would buy nothing.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Keygen {
        private_key: PathBuf,
    },
    Send {
        control: Control,
        private_key: PathBuf,
        action: AdminAction,
        /// `--yes`: the owner has read the issue confirmation.
        confirmed: bool,
    },
}

impl Command {
    /// The control-plane path a request is POSTed to.
    pub fn path(action: &AdminAction) -> &'static str {
        match action {
            AdminAction::IssueCoupon { .. } => "/api/admin/coupons/issue",
            AdminAction::RevokeCoupon { .. } => "/api/admin/coupons/revoke",
            AdminAction::ListCoupons => "/api/admin/coupons/list",
            AdminAction::ListRedemptions { .. } => "/api/admin/coupons/redemptions",
        }
    }
}

/// The signed payload for `action`, made at `now_ms` with `nonce`.
pub fn request(
    control: &Control,
    action: AdminAction,
    nonce: &[u8; NONCE_LEN],
    now_ms: u64,
) -> AdminRequest {
    AdminRequest::new(
        &control.audience,
        action,
        nonce,
        now_ms,
        REQUEST_LIFETIME_MS,
    )
    .expect("REQUEST_LIFETIME_MS is within MAX_LIFETIME_MS")
}

/// `Ok` when the control plane will read `signed` at all: its payload is within
/// `MAX_PAYLOAD_BYTES`, which only a long `--note` can exceed.
pub fn within_limit(signed: &SignedAdminRequest) -> Result<(), String> {
    if signed.payload.len() > MAX_PAYLOAD_BYTES {
        return Err(format!(
            "the request is over {MAX_PAYLOAD_BYTES} bytes; shorten --note"
        ));
    }
    Ok(())
}

pub fn parse(args: &[String]) -> Result<Command, String> {
    let (command, rest) = args.split_first().ok_or("no command")?;
    let mut flags = Flags::parse(rest, &["--yes"])?;
    let private_key = flags
        .take("--private-key")
        .map(PathBuf::from)
        .ok_or_else(|| format!("{command} needs --private-key"))?;
    let parsed = if command == "keygen" {
        Command::Keygen { private_key }
    } else {
        let action = match command.as_str() {
            "issue" => issue::action(&mut flags)?,
            "revoke" => revoke(&mut flags)?,
            "list" => AdminAction::ListCoupons,
            "redemptions" => AdminAction::ListRedemptions {
                code: required(&mut flags, "redemptions", "--code")?,
            },
            other => return Err(format!("unknown command {other}")),
        };
        let control = control(&required(&mut flags, command, "--control")?)?;
        let confirmed = command == "issue" && flags.switch("--yes");
        Command::Send {
            control,
            private_key,
            action,
            confirmed,
        }
    };
    flags.finish(command)?;
    Ok(parsed)
}

fn required(flags: &mut Flags, command: &str, flag: &str) -> Result<String, String> {
    flags
        .take(flag)
        .ok_or_else(|| format!("{command} needs {flag}"))
}

fn revoke(flags: &mut Flags) -> Result<AdminAction, String> {
    let code = required(flags, "revoke", "--code")?;
    let also_revoke_grants = match required(flags, "revoke", "--also-revoke-grants")?.as_str() {
        "yes" => true,
        "no" => false,
        other => return Err(format!("--also-revoke-grants {other:?} is yes or no")),
    };
    Ok(AdminAction::RevokeCoupon {
        code,
        also_revoke_grants,
    })
}

#[cfg(test)]
mod tests;
