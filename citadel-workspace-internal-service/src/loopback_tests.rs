//! Tests for loopback.rs: the pure resolver, and the cache round-trip.
use super::*;

fn inputs(root: &Path) -> TlsInputs<'_> {
    TlsInputs::none(root)
}

#[test]
fn nothing_configured_is_plain() {
    assert_eq!(
        choose_tls(&inputs(Path::new("/d"))).unwrap(),
        TlsChoice::Plain
    );
}

#[test]
fn a_name_without_a_certificate_source_is_refused_not_silently_plain() {
    let mut i = inputs(Path::new("/d"));
    i.cli_host = Some("local.example.com");
    let err = choose_tls(&i).unwrap_err();
    assert!(err.contains("no certificate source"), "{err}");
}

#[test]
fn a_url_fetches_and_caches_under_the_data_dir_and_env_wins_over_cli() {
    let mut i = inputs(Path::new("/data"));
    i.cli_cert_url = Some("https://cli.example/agent/");
    i.env_cert_url = Some("https://env.example/agent/");
    i.cli_host = Some("Local.Example.com");
    assert_eq!(
        choose_tls(&i).unwrap(),
        TlsChoice::Fetch {
            url: "https://env.example/agent".into(),
            cache_dir: PathBuf::from("/data/loopback"),
            name: Some("local.example.com".into())
        }
    );
}

#[test]
fn files_go_together_and_a_plain_http_url_is_refused() {
    let mut i = inputs(Path::new("/d"));
    i.cli_cert = Some("/c.pem");
    assert!(choose_tls(&i).unwrap_err().contains("go together"));
    i.cli_key = Some("/k.pem");
    assert_eq!(
        choose_tls(&i).unwrap(),
        TlsChoice::Files {
            cert: "/c.pem".into(),
            key: "/k.pem".into(),
            name: None
        }
    );
    let mut j = inputs(Path::new("/d"));
    j.cli_cert_url = Some("http://insecure.example/agent");
    assert!(choose_tls(&j).unwrap_err().contains("https://"));
}

#[test]
fn two_sources_and_a_malformed_name_are_refused() {
    let mut i = inputs(Path::new("/d"));
    i.cli_cert_url = Some("https://x.example/agent");
    i.cli_cert = Some("/c.pem");
    i.cli_key = Some("/k.pem");
    assert!(choose_tls(&i).unwrap_err().contains("one source"));
    for bad in [
        "wss://local.example.com",
        "local.example.com:12345",
        "local.example.com/ws",
        ".local",
        "lo cal",
    ] {
        let mut j = inputs(Path::new("/d"));
        j.cli_host = Some(bad);
        j.cli_cert_url = Some("https://x.example/agent");
        assert!(
            choose_tls(&j).unwrap_err().contains("bare DNS name"),
            "{bad}"
        );
    }
}

#[test]
fn empty_strings_are_unset() {
    let mut i = inputs(Path::new("/d"));
    i.env_cert_url = Some("  ");
    i.cli_cert_url = Some("https://cli.example/agent");
    assert!(
        matches!(choose_tls(&i).unwrap(), TlsChoice::Fetch { url, .. } if url == "https://cli.example/agent")
    );
}

#[test]
fn the_cache_round_trips_and_the_key_is_private() {
    let dir = std::env::temp_dir().join(format!("citadel-loopback-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let pem = Pem {
        certificate: b"-----BEGIN CERTIFICATE-----\nx\n".to_vec(),
        key: b"-----BEGIN PRIVATE KEY-----\ny\n".to_vec(),
    };
    store(&dir, &pem).unwrap();
    let back = load(&dir).expect("cached pair loads");
    assert_eq!(back.certificate, pem.certificate);
    assert_eq!(back.key, pem.key);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(dir.join("loopback.key"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    std::fs::write(dir.join("loopback.key"), b"").unwrap();
    assert!(
        load(&dir).is_none(),
        "an empty key file is not a cached pair"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn files_that_do_not_exist_are_named() {
    let err = obtain(&TlsChoice::Files {
        cert: "/nonexistent/c.pem".into(),
        key: "/nonexistent/k.pem".into(),
        name: None,
    })
    .unwrap_err();
    assert!(err.contains("/nonexistent/c.pem"), "{err}");
}
