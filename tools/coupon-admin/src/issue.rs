//! `issue`'s flags as an `IssueCoupon`. Which templates, grants, tiers and intervals exist is the
//! control plane's to judge against `billing/tiers.json`; this checks only what the tool itself
//! promises: every field is stated, and a grant is bounded.

use citadel_support_signature::{AdminAction, CouponShape};
use control_request::{number, Flags};

fn list(flags: &mut Flags, flag: &str) -> Result<Vec<String>, String> {
    let text = flags
        .take(flag)
        .ok_or_else(|| format!("issue needs {flag}"))?;
    let items: Vec<String> = text.split(',').map(|s| s.trim().to_string()).collect();
    if items.iter().any(String::is_empty) {
        return Err(format!(
            "{flag} {text:?} is a comma-separated list with no empty item"
        ));
    }
    Ok(items)
}

pub(crate) fn action(flags: &mut Flags) -> Result<AdminAction, String> {
    let code = flags.take("--code").ok_or("issue needs --code")?;
    let shape = match (flags.take("--template"), flags.take("--grant")) {
        (Some(template), None) => CouponShape::Template(template),
        (None, Some(grant)) => CouponShape::Grant(grant),
        _ => return Err("issue needs exactly one of --template and --grant".to_string()),
    };
    let available_on = list(flags, "--available-on")?;
    let intervals = list(flags, "--intervals")?;
    let max_redemptions: u32 = number(
        "--max-redemptions",
        &flags
            .take("--max-redemptions")
            .ok_or("issue needs --max-redemptions")?,
    )?;
    if max_redemptions == 0 {
        return Err("--max-redemptions is at least 1".to_string());
    }
    let redeem_by_ms: Option<u64> = flags
        .take("--redeem-by")
        .map(|v| number("--redeem-by", &v))
        .transpose()?;
    if matches!(shape, CouponShape::Grant(_)) && redeem_by_ms.is_none() {
        return Err(
            "a grant may be unlimited: issue it only with --max-redemptions and --redeem-by"
                .to_string(),
        );
    }
    let note = flags.take("--note").ok_or("issue needs --note")?;
    Ok(AdminAction::IssueCoupon {
        code,
        shape,
        available_on,
        intervals,
        max_redemptions,
        redeem_by_ms,
        note,
    })
}
