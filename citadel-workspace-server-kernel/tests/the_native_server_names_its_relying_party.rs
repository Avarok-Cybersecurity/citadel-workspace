//! A native server names the WebAuthn relying party its security keys are scoped to, and will not
//! start without one. The server puts it in every sign-in challenge, and a key enrolled under one
//! ID can never sign in under another, so there is no default to fall back on.
//!
//! Real: `native_sign_in`, the function `run_server_with_base_path` calls, over a real seed file.

use citadel_workspace_server_kernel::kernel::sign_in::config::NativeSignInConfig;
use citadel_workspace_server_kernel::kernel::sign_in::native::native_sign_in;
use citadel_workspace_server_kernel::kernel::sign_in::turnstile::{
    SiteVerify, SiteVerifyUnreachable,
};
use citadel_workspace_server_kernel::kernel::sign_in::HostedSignIn;
use common::production_server::{sign_in_dir, sign_in_without_admission};
use std::collections::HashMap;
use std::sync::Arc;

/// Startup never asks siteverify; reaching it is a failure.
struct Unreached;

#[async_trait::async_trait]
impl SiteVerify for Unreached {
    async fn verify(
        &self,
        _: &str,
        _: &str,
        _: Option<&str>,
    ) -> Result<serde_json::Value, SiteVerifyUnreachable> {
        panic!("siteverify was asked at startup")
    }
}

/// The relying party the shared test config names.
const NAMED: &str = "security_key_rp_id = \"localhost\"\n";

fn start(kernel_toml: &str) -> Result<HostedSignIn, String> {
    let mut sections: HashMap<String, NativeSignInConfig> =
        toml::from_str(kernel_toml).expect("parses");
    let section = sections.remove("sign_in").expect("[sign_in]");
    native_sign_in(Some(&section), &|_| None, Arc::new(Unreached))
}

#[test]
fn the_relying_party_is_required() {
    let config = sign_in_without_admission(&sign_in_dir());
    let without = config.replace(NAMED, "");
    assert_ne!(without, config, "the control did not remove the key");
    let refused = start(&without)
        .err()
        .expect("started without a relying party");
    assert!(
        refused.contains("security_key_rp_id is required"),
        "{refused}"
    );
}

#[test]
fn the_relying_party_is_a_bare_domain() {
    let config = sign_in_without_admission(&sign_in_dir());
    for bad in [
        "https://work.example.com",
        "work.example.com:443",
        "Work.Example.com",
    ] {
        let named = config.replace("\"localhost\"", &format!("{bad:?}"));
        assert_ne!(named, config, "the control did not change the value");
        let refused = start(&named)
            .err()
            .expect("started with a bad relying party");
        assert!(refused.contains("relying party"), "{bad}: {refused}");
    }
}

#[test]
fn the_named_relying_party_is_the_one_the_server_uses() {
    let config = sign_in_without_admission(&sign_in_dir());
    let started = start(&config).expect("a bare domain starts");
    let settings = started.pq_sign_in.expect("post-quantum sign-in");
    assert_eq!(settings.security_key_rp_id(), Some("localhost"));
}
