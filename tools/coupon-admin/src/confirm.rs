//! What `issue` tells the owner before it sends anything (revision 2 R1: the ceilings an
//! unlimited tenant still meets, and the relay cost nothing cuts). The numbers the repository
//! owns are read from their sources at build time, so this text cannot drift from them.

use citadel_support_signature::{AdminAction, CouponShape};

const TIERS: &str = include_str!("../../../billing/tiers.json");
const ICE: &str = include_str!("../../../deploy/tenant-worker/control/ice.mjs");
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
/// The design's recommendation for a grant: one partner per code, at most 30 days to redeem.
const GRANT_ADVISED_DAYS: u64 = 30;

/// Cloudflare Realtime TURN's list price, as `billing/tiers.json`'s relay-overage note records it.
const TURN_LIST_PRICE: &str = "USD 0.05 per GB";

/// `metering.max_frame_bytes` from `billing/tiers.json`.
fn max_frame_bytes() -> Result<u64, String> {
    let tiers: serde_json::Value =
        serde_json::from_str(TIERS).map_err(|e| format!("billing/tiers.json: {e}"))?;
    tiers["metering"]["max_frame_bytes"]
        .as_u64()
        .ok_or_else(|| "billing/tiers.json has no metering.max_frame_bytes".to_string())
}

/// `MINTS_PER_HOUR` from `deploy/tenant-worker/control/ice.mjs`.
fn turn_mints_per_hour() -> Result<u64, String> {
    const DECLARATION: &str = "export const MINTS_PER_HOUR = ";
    ICE.lines()
        .find_map(|line| line.strip_prefix(DECLARATION))
        .and_then(|rest| rest.strip_suffix(';'))
        .and_then(|n| n.parse().ok())
        .ok_or_else(|| format!("control/ice.mjs no longer declares `{DECLARATION}<n>;`"))
}

fn days(ms: u64) -> String {
    format!("{:.1}", ms as f64 / DAY_MS as f64)
}

/// The confirmation `issue` prints for `action` at `now_ms`.
pub fn confirmation(action: &AdminAction, now_ms: u64) -> Result<String, String> {
    let AdminAction::IssueCoupon {
        code,
        shape,
        available_on,
        intervals,
        max_redemptions,
        redeem_by_ms,
        note,
    } = action
    else {
        return Err("only an issue has a confirmation".to_string());
    };
    let (kind, id) = match shape {
        CouponShape::Template(id) => ("template", id),
        CouponShape::Grant(id) => ("grant", id),
    };
    let deadline = match redeem_by_ms {
        Some(at) if *at <= now_ms => return Err(format!("--redeem-by {at} has already passed")),
        Some(at) => format!("until {at} ({} days from now)", days(at - now_ms)),
        None => "with no deadline".to_string(),
    };
    let mut text = format!(
        "Issue coupon {code} ({kind} {id:?}) on {} billed {}: at most {max_redemptions} \
         redemption(s), redeemable {deadline}. Note: {note:?}.\n",
        available_on.join(", "),
        intervals.join(", ")
    );
    if let (CouponShape::Grant(_), Some(at)) = (shape, redeem_by_ms) {
        if *max_redemptions > 1 || at - now_ms > GRANT_ADVISED_DAYS * DAY_MS {
            text.push_str(&format!(
                "ADVISED: one redemption per design partner, redeemable for at most \
                 {GRANT_ADVISED_DAYS} days.\n"
            ));
        }
        text.push_str(
            "A grant may be unlimited (tiers.json decides): such a tenant has no member, \
             storage, connection, relay or secure-link limit.\n",
        );
    }
    text.push_str(&format!(
        "Whatever its plan, every tenant that redeems it still meets these platform ceilings:\n\
         \x20 - one WebSocket message of at most {} bytes (tiers.json metering.max_frame_bytes);\n\
         \x20 - the kernel's per-CID request rate limit (kernel/rate_limiter.rs);\n\
         \x20 - {} TURN credentials per member per hour (control/ice.mjs);\n\
         \x20 - one workspace, one Durable Object, per slug;\n\
         \x20 - the app resource caps (artifact size, worker memory, per-request egress);\n\
         \x20 - a Durable Object's 128 MB of memory and its SQLite size: reaching them fails \
         loudly with the existing errors.\n",
        max_frame_bytes()?,
        turn_mints_per_hour()?
    ));
    text.push_str(&format!(
        "RELAY COST: TURN relay is the one cost that can run without a cut-off. Relayed media is \
         billed to Avarok's Cloudflare account at Realtime TURN's list price ({TURN_LIST_PRICE}) \
         once the account-wide free TURN allowance, shared by every tenant, is used up. Spend \
         alarms report it and cut nothing; `revoke --also-revoke-grants yes` ends a grant.\n"
    ));
    Ok(text)
}

/// What to print before sending `action`, or why it must not be sent: an issue is sent only
/// once its confirmation has been read (`--yes`).
pub fn preflight(
    action: &AdminAction,
    confirmed: bool,
    now_ms: u64,
) -> Result<Option<String>, String> {
    if !matches!(action, AdminAction::IssueCoupon { .. }) {
        return Ok(None);
    }
    let text = confirmation(action, now_ms)?;
    if confirmed {
        Ok(Some(text))
    } else {
        Err(format!(
            "{text}\nNothing was sent: rerun with --yes once the above is what you mean."
        ))
    }
}
