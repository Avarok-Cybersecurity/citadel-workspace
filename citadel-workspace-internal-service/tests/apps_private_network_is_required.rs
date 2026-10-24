//! The shipped agent refuses to start until `apps.private_network` is configured, and reads
//! it from its command line: no default reaches host egress.
//!
//! Runs the real binary with exactly the arguments 0.10.6's launcher passed
//! (packaging/linux/citadel-agent-launch.in at agent-v0.10.6): the command a tarball or
//! hand-run agent relaunches with after a self-update, so the only thing missing is the one
//! under test. Both runs exit before anything listens (`support::agent_that_exits`).
mod support;

#[test]
fn the_last_shipped_launchers_arguments_are_refused_naming_the_flag() {
    let output = support::agent_that_exits("unset", &[]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success());
    // The refusal is all a member who relaunched by hand sees: it must name what to add.
    for named in [
        "apps.private_network is not configured",
        "--apps-private-network",
        "INTERNAL_SERVICE_APPS_PRIVATE_NETWORK",
    ] {
        assert!(stderr.contains(named), "{named} missing from: {stderr}");
    }
}

#[test]
fn the_setting_is_read_from_the_command_line() {
    // The control: the refusal above is the missing setting's, and the flag reaches the check.
    let output = support::agent_that_exits("invalid", &["--apps-private-network", "maybe"]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success());
    assert!(
        stderr.contains("invalid --apps-private-network"),
        "{stderr}"
    );
}
