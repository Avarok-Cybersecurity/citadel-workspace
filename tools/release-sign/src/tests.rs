use super::*;

fn args(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_string).collect()
}

#[test]
fn each_command_parses_with_exactly_its_flags() {
    assert_eq!(
        parse(&args("keygen --private-key k")).unwrap(),
        Command::Keygen {
            private_key: "k".into(),
            public_key: None
        }
    );
    assert_eq!(
        parse(&args("sign --private-key k --tag agent-v1.0.0 a b")).unwrap(),
        Command::Sign {
            private_key: "k".into(),
            tag: "agent-v1.0.0".into(),
            assets: vec!["a".into(), "b".into()]
        }
    );
    assert!(matches!(
        parse(&args("verify --public-key p --tag t a")),
        Ok(Command::Verify { .. })
    ));
    for bad in [
        "",
        "keygen",
        "keygen --private-key k a",
        "sign --private-key k a",
        "sign --private-key k --tag t",
        "sign --public-key p --private-key k --tag t a",
        "verify --private-key k --tag t a",
        "check-key --public-key p a",
        "sign --private-key",
        "sign --bogus x",
        "rotate",
    ] {
        assert!(parse(&args(bad)).is_err(), "{bad:?}");
    }
}

#[test]
fn a_signature_is_beside_its_asset_and_names_its_file() {
    let asset = Path::new("dist/Citadel-Agent.dmg");
    assert_eq!(
        signature_path(asset),
        Path::new("dist/Citadel-Agent.dmg.mldsa.sig")
    );
    assert_eq!(asset_name(asset).unwrap(), "Citadel-Agent.dmg");
}

#[test]
fn what_sign_writes_verify_accepts_and_nothing_else() {
    // Fixture seeds; no release key derives from either.
    let key = ReleaseSigningKey::from_seed(&[1; 32]);
    let public = key.public_key_hex();
    let tag = "agent-v0.9.0";
    let sig = sign(&key, tag, "a.tar.gz", b"bytes").unwrap();
    assert!(sig.ends_with('\n'));
    assert_eq!(verify(&public, tag, "a.tar.gz", b"bytes", &sig), Ok(()));
    let other = ReleaseSigningKey::from_seed(&[2; 32]).public_key_hex();
    assert!(verify(&public, tag, "a.tar.gz", b"bytez", &sig).is_err());
    assert!(verify(&public, "agent-v0.9.1", "a.tar.gz", b"bytes", &sig).is_err());
    assert!(verify(&public, tag, "b.tar.gz", b"bytes", &sig).is_err());
    assert!(verify(&other, tag, "a.tar.gz", b"bytes", &sig).is_err());
    assert!(verify(&public, tag, "a.tar.gz", b"bytes", &sig[..100]).is_err());
}
