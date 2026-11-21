//! The server kernel has no switch that skips certificate verification: a kernel.toml that
//! still names the removed `dangerous_skip_cert_verification` is refused when it is read, rather
//! than read as though the key meant something. Any key the kernel does not know is refused the
//! same way.

use citadel_workspace_server_kernel::config::ServerConfig;

fn parse(extra: &str) -> Result<ServerConfig, toml::de::Error> {
    toml::from_str(&format!("bind_addr = \"127.0.0.1:0\"\n{extra}"))
}

#[test]
fn the_removed_certificate_skip_is_refused() {
    let err = parse("dangerous_skip_cert_verification = true")
        .expect_err("a config naming the removed key is refused");
    assert!(
        err.to_string().contains("dangerous_skip_cert_verification"),
        "{err}"
    );
}

#[test]
fn a_config_without_it_reads() {
    assert!(parse("").is_ok());
}
