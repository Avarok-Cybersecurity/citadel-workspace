use super::*;
use citadel_support_signature::{verify, SupportSigningKey, SEED_LEN};

fn args(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_string).collect()
}

const CONTROL: &str = "--control https://work.avarok.net --private-key k";

#[test]
fn each_command_parses_with_exactly_its_flags() {
    assert_eq!(
        parse(&args("keygen --private-key k")),
        Ok(Command::Keygen {
            private_key: "k".into()
        })
    );
    let Ok(Command::Read {
        control, action, ..
    }) = parse(&args(&format!("list {CONTROL}")))
    else {
        panic!("a list");
    };
    assert_eq!(control.audience, "work.avarok.net");
    assert_eq!(action, SupportAction::ListGrants);
    let fetch = format!(
        "fetch {CONTROL} --tenant acme --limit 50 --offset 100 --user bob --peer-cid 42 \
         --min-level error --since-ms 1 --until-ms 2"
    );
    assert_eq!(
        parse(&args(&fetch)).map(|c| match c {
            Command::Read { action, .. } => action,
            other => panic!("{other:?}"),
        }),
        Ok(SupportAction::FetchTelemetry {
            tenant: "acme".into(),
            filter: TelemetryFilter {
                user_id: Some("bob".into()),
                peer_cid: Some(42),
                min_level: Some(TelemetryLevel::Error),
                since_ms: Some(1),
                until_ms: Some(2),
            },
            page: TelemetryPage {
                offset: 100,
                limit: 50
            },
        })
    );
}

#[test]
fn a_command_missing_or_misusing_a_flag_is_refused() {
    for bad in [
        "".to_string(),
        "keygen".to_string(),
        "keygen --private-key k --tenant acme".to_string(),
        "list --private-key k".to_string(),
        format!("list {CONTROL} --tenant acme"),
        format!("fetch {CONTROL} --limit 5"),
        format!("fetch {CONTROL} --tenant acme"),
        format!("fetch {CONTROL} --tenant acme --limit 0"),
        format!("fetch {CONTROL} --tenant acme --limit 501"),
        format!("fetch {CONTROL} --tenant acme --limit 5 --min-level info"),
        format!("fetch {CONTROL} --tenant acme --limit 5 --limit 6"),
        "list --control http://work.avarok.net --private-key k".to_string(),
        "list --control https://work.avarok.net/api --private-key k".to_string(),
        "list --control https://work.avarok.net:8443 --private-key k".to_string(),
        "sign --private-key k".to_string(),
    ] {
        assert!(parse(&args(&bad)).is_err(), "{bad:?} parsed");
    }
}

#[test]
fn a_request_is_signed_for_the_control_planes_host_and_verifies_there() {
    let control = control("https://Work.Avarok.net").expect("an origin");
    let key = SupportSigningKey::from_seed(&[1; SEED_LEN]); // a fixed test key, never a real one
    let now = 1_800_000_000_000;
    let signed = key.sign(&request(
        &control,
        SupportAction::ListGrants,
        &[2; NONCE_LEN],
        now,
    ));
    let verified = verify(&key.public_key_hex(), &signed, "work.avarok.net", now).expect("ok");
    assert_eq!(verified.expires_at_ms, now + REQUEST_LIFETIME_MS);
    assert!(verify(
        &key.public_key_hex(),
        &signed,
        "work.avarok.net",
        now + REQUEST_LIFETIME_MS
    )
    .is_err());
    assert_eq!(Command::path(&verified.action), "/api/support/grants");
}
