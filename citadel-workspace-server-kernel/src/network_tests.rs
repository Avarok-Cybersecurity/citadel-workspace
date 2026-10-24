use crate::network::*;

fn list(entries: &[&str]) -> Vec<String> {
    entries.iter().map(|s| s.to_string()).collect()
}

#[test]
fn a_native_server_without_stun_servers_names_the_key() {
    let error = format!("{:?}", native_stun_servers(None).unwrap_err());
    assert!(error.contains("stun_servers"), "{error}");
}

#[test]
fn a_native_list_is_held_to_the_sdks_rules() {
    for bad in [
        list(&[]),
        list(&["a.example:3478", "b.example:3478"]),
        list(&["a.example:3478", "a.example:3478", "b.example:3478"]),
        list(&["stun:a.example:3478", "b.example:3478", "c.example:3478"]),
    ] {
        let error = format!("{:?}", native_stun_servers(Some(&bad)).unwrap_err());
        assert!(
            error.contains("kernel.toml stun_servers"),
            "{bad:?}: {error}"
        );
    }
}

#[test]
fn a_native_list_reaches_the_builder_in_order() {
    let configured = list(&["c.example:3478", "a.example:3478", "198.51.100.7:3478"]);
    let servers = native_stun_servers(Some(&configured)).unwrap();
    assert_eq!(builder_list(&servers), configured);
}

#[test]
fn a_hosted_config_may_not_name_stun_servers() {
    assert!(refuse_configured_stun_servers(None).is_ok());
    let named = list(&["a.example:3478", "b.example:3478", "c.example:3478"]);
    let error = format!(
        "{:?}",
        refuse_configured_stun_servers(Some(&named)).unwrap_err()
    );
    assert!(error.contains("host supplies"), "{error}");
}
