//! Who becomes the administrator of a fresh workspace.
//!
//! The root workspace is seeded at boot with no owner, and on connect any
//! authenticated account is added to it. The first one was promoted to Admin
//! unconditionally. Registration has no invite gate and the install docs tell
//! operators to bind `0.0.0.0:12349` and open the firewall — so on a fresh
//! public deployment, whoever found the port and registered before the operator
//! became the administrator of the workspace, and everyone after them joined a
//! workspace they did not control.
//!
//! The behaviour survives because a local dev stack depends on it — without it
//! every account stays a Member with no editing rights — but it has to be asked
//! for by name now. These tests pin the two things that matter: unset means
//! off, and a value the operator plainly meant as "on" is never silently read
//! as "off".

use citadel_workspace_server_kernel::resolve_first_connect_admin;

#[test]
fn unset_is_off() {
    // The safe value is the one you get by not thinking about it.
    assert!(!resolve_first_connect_admin(None, None).expect("unset resolves"));
}

#[test]
fn an_empty_or_blank_value_is_treated_as_unset() {
    // `FOO=${FOO}` in a compose file with nothing in .env produces exactly this.
    assert!(!resolve_first_connect_admin(Some(""), None).expect("empty resolves"));
    assert!(!resolve_first_connect_admin(Some("   "), None).expect("blank resolves"));
}

#[test]
fn the_env_var_turns_it_on() {
    for value in ["1", "true", "TRUE", "yes", "on", " true "] {
        assert!(
            resolve_first_connect_admin(Some(value), None).expect("resolves"),
            "'{value}' is something an operator would write meaning yes"
        );
    }
}

#[test]
fn the_env_var_turns_it_off() {
    for value in ["0", "false", "no", "off"] {
        assert!(
            !resolve_first_connect_admin(Some(value), None).expect("resolves"),
            "'{value}' means no"
        );
    }
}

#[test]
fn the_env_var_overrides_the_config_file() {
    assert!(!resolve_first_connect_admin(Some("0"), Some(true)).expect("resolves"));
    assert!(resolve_first_connect_admin(Some("1"), Some(false)).expect("resolves"));
}

#[test]
fn a_value_that_means_nothing_is_an_error_not_a_silent_no() {
    // Reading garbage as "off" would leave a dev stack with no administrator
    // and nothing to explain why. Reading it as "on" would be worse.
    let err = resolve_first_connect_admin(Some("maybe"), None)
        .expect_err("a meaningless value must not resolve");
    let message = err.to_string();
    assert!(
        message.contains("WORKSPACE_ALLOW_FIRST_CONNECT_ADMIN"),
        "the error has to name the variable: {message}"
    );
    assert!(
        message.contains("maybe"),
        "and echo what was actually set: {message}"
    );
}

#[test]
fn the_config_file_can_set_it_when_the_env_is_silent() {
    assert!(resolve_first_connect_admin(None, Some(true)).expect("resolves"));
    assert!(!resolve_first_connect_admin(None, Some(false)).expect("resolves"));
}

/// The kernel's own default, independent of how the value is parsed.
///
/// The resolver above could be perfect and still leave the hole open if the
/// kernel started out permissive and only ever got tightened by a bootstrap
/// path that a test harness, an embedder or a future entry point skipped.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_kernel_is_not_permissive_until_told_otherwise() {
    use citadel_sdk::prelude::MonoRatchet;
    use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;

    let mut kernel = AsyncWorkspaceServerKernel::<MonoRatchet>::new(None);
    assert!(
        !kernel.first_connect_admin(),
        "a freshly constructed kernel must not promote the first account to connect"
    );

    kernel.set_first_connect_admin(true);
    assert!(
        kernel.first_connect_admin(),
        "and must honour being told to"
    );

    // Clones share the setting: connection tasks work from a clone, so a clone
    // that lost it would silently reinstate the safe-looking default while the
    // operator had asked for the other one.
    let clone = kernel.clone();
    assert!(
        clone.first_connect_admin(),
        "the setting must survive a clone"
    );
}
