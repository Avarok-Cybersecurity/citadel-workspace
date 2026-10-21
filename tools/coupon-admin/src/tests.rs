use super::*;
use citadel_support_signature::{verify_admin, AdminSigningKey, CouponShape, SEED_LEN};

fn args(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_string).collect()
}

const CONTROL: &str = "--control https://work.avarok.net --private-key k";
const NOW: u64 = 1_800_000_000_000;
const DAY: u64 = 24 * 60 * 60 * 1000;

fn grant(extra: &str) -> String {
    format!(
        "issue {CONTROL} --code PARTNER-ACME --grant design-partner --available-on business \
         --intervals month,year --note acme {extra}"
    )
}

fn action_of(text: &str) -> Result<(AdminAction, bool), String> {
    match parse(&args(text))? {
        Command::Send {
            action, confirmed, ..
        } => Ok((action, confirmed)),
        other => panic!("{other:?}"),
    }
}

#[test]
fn each_command_parses_with_exactly_its_flags() {
    assert_eq!(
        parse(&args("keygen --private-key k")),
        Ok(Command::Keygen {
            private_key: "k".into()
        })
    );
    let redeem_by = NOW + 7 * DAY;
    assert_eq!(
        action_of(&grant(&format!(
            "--max-redemptions 1 --redeem-by {redeem_by} --yes"
        ))),
        Ok((
            AdminAction::IssueCoupon {
                code: "PARTNER-ACME".into(),
                shape: CouponShape::Grant("design-partner".into()),
                available_on: vec!["business".into()],
                intervals: vec!["month".into(), "year".into()],
                max_redemptions: 1,
                redeem_by_ms: Some(redeem_by),
                note: "acme".into(),
            },
            true
        ))
    );
    let template = format!(
        "issue {CONTROL} --code LAUNCH20 --template pct-20-3mo --available-on team,business \
         --intervals month --max-redemptions 100 --note launch"
    );
    assert!(matches!(
        action_of(&template),
        Ok((
            AdminAction::IssueCoupon {
                redeem_by_ms: None,
                ..
            },
            false
        ))
    ));
    assert_eq!(
        action_of(&format!(
            "revoke {CONTROL} --code PARTNER-ACME --also-revoke-grants no"
        )),
        Ok((
            AdminAction::RevokeCoupon {
                code: "PARTNER-ACME".into(),
                also_revoke_grants: false
            },
            false
        ))
    );
    assert_eq!(
        action_of(&format!("list {CONTROL}")),
        Ok((AdminAction::ListCoupons, false))
    );
    assert_eq!(
        action_of(&format!("redemptions {CONTROL} --code X")),
        Ok((AdminAction::ListRedemptions { code: "X".into() }, false))
    );
}

#[test]
fn a_grant_is_refused_without_both_bounds() {
    let by = NOW + DAY;
    for missing in [
        format!("--redeem-by {by}"),
        "--max-redemptions 1".to_string(),
        String::new(),
    ] {
        assert!(action_of(&grant(&missing)).is_err(), "{missing:?}");
    }
    assert!(action_of(&grant(&format!("--max-redemptions 1 --redeem-by {by}"))).is_ok());
}

#[test]
fn a_command_missing_or_misusing_a_flag_is_refused() {
    let by = NOW + DAY;
    for bad in [
        String::new(),
        "keygen".to_string(),
        "keygen --private-key k --yes".to_string(),
        format!("list {CONTROL} --yes"),
        format!("list {CONTROL} --code X"),
        "list --private-key k".to_string(),
        format!("redemptions {CONTROL}"),
        format!("revoke {CONTROL} --code X"),
        format!("revoke {CONTROL} --code X --also-revoke-grants maybe"),
        format!("revoke {CONTROL} --code X --also-revoke-grants yes --yes"),
        grant(&format!("--max-redemptions 0 --redeem-by {by}")),
        grant(&format!("--max-redemptions 1 --redeem-by {by} --template t")),
        grant("--max-redemptions 1 --redeem-by soon"),
        format!("issue {CONTROL} --code X --template t --available-on team, --intervals month --max-redemptions 1 --note n"),
        format!("issue {CONTROL} --code X --template t --available-on team --intervals month --max-redemptions 1"),
        "list --control http://work.avarok.net --private-key k".to_string(),
        "sign --private-key k".to_string(),
    ] {
        assert!(parse(&args(&bad)).is_err(), "{bad:?} parsed");
    }
}

#[test]
fn an_issue_is_sent_only_after_its_confirmation_and_says_what_still_binds() {
    let (issue, _) = action_of(&grant(&format!(
        "--max-redemptions 1 --redeem-by {}",
        NOW + 7 * DAY
    )))
    .expect("parses");
    let refused = preflight(&issue, false, NOW).expect_err("not confirmed");
    assert!(refused.contains("Nothing was sent"), "{refused}");
    let shown = preflight(&issue, true, NOW)
        .expect("confirmed")
        .expect("a notice");
    for needle in [
        "PARTNER-ACME",
        "7.0 days from now",
        "4194304 bytes",
        "30 TURN credentials per member per hour",
        "per-CID request rate limit",
        "128 MB",
        "RELAY COST",
        "USD 0.05 per GB",
        "may be unlimited",
    ] {
        assert!(shown.contains(needle), "{needle:?} missing from:\n{shown}");
        assert!(
            refused.contains(needle),
            "{needle:?} missing from the refusal"
        );
    }
    assert!(!shown.contains("ADVISED"), "one redemption within 30 days");
    assert_eq!(preflight(&AdminAction::ListCoupons, false, NOW), Ok(None));
}

#[test]
fn a_loose_or_stale_grant_is_flagged_or_refused() {
    let (loose, _) = action_of(&grant(&format!(
        "--max-redemptions 5 --redeem-by {}",
        NOW + 90 * DAY
    )))
    .expect("parses");
    assert!(confirmation(&loose, NOW).expect("ok").contains("ADVISED"));
    let (stale, _) =
        action_of(&grant(&format!("--max-redemptions 1 --redeem-by {NOW}"))).expect("parses");
    assert!(preflight(&stale, true, NOW).is_err());
    assert!(preflight(&stale, true, NOW - 1).is_ok());
}

#[test]
fn a_request_is_signed_for_the_control_planes_host_and_verifies_there() {
    let control = control("https://Work.Avarok.net").expect("an origin");
    let key = AdminSigningKey::from_seed(&[1; SEED_LEN]); // a fixed test key, never a real one
    let signed = key.sign(&request(
        &control,
        AdminAction::ListCoupons,
        &[2; NONCE_LEN],
        NOW,
    ));
    let verified =
        verify_admin(&key.public_key_hex(), &signed, "work.avarok.net", NOW).expect("ok");
    assert_eq!(verified.expires_at_ms, NOW + REQUEST_LIFETIME_MS);
    assert!(verify_admin(
        &key.public_key_hex(),
        &signed,
        "work.avarok.net",
        NOW + REQUEST_LIFETIME_MS
    )
    .is_err());
    assert_eq!(Command::path(&verified.action), "/api/admin/coupons/list");
    assert_eq!(within_limit(&signed), Ok(()));
}

#[test]
fn a_request_too_long_to_be_read_is_not_sent() {
    let control = control("https://work.avarok.net").expect("an origin");
    let key = AdminSigningKey::from_seed(&[1; SEED_LEN]);
    let note = |n: usize| AdminAction::IssueCoupon {
        code: "X".into(),
        shape: CouponShape::Template("t".into()),
        available_on: vec!["team".into()],
        intervals: vec!["month".into()],
        max_redemptions: 1,
        redeem_by_ms: None,
        note: "n".repeat(n),
    };
    let sign = |n| key.sign(&request(&control, note(n), &[2; NONCE_LEN], NOW));
    assert!(within_limit(&sign(MAX_PAYLOAD_BYTES)).is_err());
    assert!(within_limit(&sign(100)).is_ok());
}

#[test]
fn keygen_writes_a_private_file_and_the_public_key_is_not_the_secret() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let path = dir.path().join("admin.key");
    let seed = release_sign::keyfile::create_seed_file(&path).expect("created");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path).expect("stat").permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    let public = AdminSigningKey::from_seed(&seed).public_key_hex();
    let secret = std::fs::read_to_string(&path).expect("read");
    assert!(!public.contains(secret.trim()));
}
