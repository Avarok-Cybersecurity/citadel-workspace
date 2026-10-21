//! A server says what its document limits are, or it does not start.
//!
//! No bound has a value that is right everywhere: a Worker-hosted tenant has a fraction of a
//! native server's memory, and what a client sends depends on the editor. So `[documents]` is
//! required, every key in it is required, and none may be zero.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::resolve_documents_relay;
use common::documents_test_utils::{shipped_documents_config, shipped_documents_section};

fn config(extra: &str) -> ServerConfig {
    toml::from_str(&format!("bind_addr = \"127.0.0.1:0\"\n{extra}")).expect("config")
}

#[test]
fn a_server_without_a_documents_section_refuses_to_start() {
    let refusal = resolve_documents_relay(&config(""))
        .err()
        .expect("started without limits");
    assert!(refusal.into_string().contains("[documents] must be set"));
}

#[test]
fn the_shipped_config_names_every_limit() {
    let relay = resolve_documents_relay(&config(&shipped_documents_section()))
        .expect("the shipped kernel.toml does not start a server");
    assert_eq!(relay.config, shipped_documents_config());
}

#[test]
fn a_zero_limit_refuses_to_start() {
    let section = shipped_documents_section().replace(
        &format!(
            "max_updates_per_pull = {}",
            shipped_documents_config().max_updates_per_pull
        ),
        "max_updates_per_pull = 0",
    );
    assert!(
        section.contains("max_updates_per_pull = 0"),
        "the replacement matched nothing"
    );
    let refusal = resolve_documents_relay(&config(&section))
        .err()
        .expect("started with a zero page");
    assert!(refusal.into_string().contains("max_updates_per_pull"));
}

#[test]
fn an_unknown_key_is_an_error_not_an_ignored_line() {
    // A misspelt limit is an unknown key beside the real one: ignored, it would look applied.
    let section = format!("{}\nawareness_per_sec = 1\n", shipped_documents_section());
    let parsed: Result<ServerConfig, _> =
        toml::from_str(&format!("bind_addr = \"127.0.0.1:0\"\n{section}"));
    assert!(parsed.is_err(), "an unknown limit was ignored");
}
