//! A server that stops taking part with older agents ships with the page that tells their
//! users to update.
//!
//! The SDK refuses any node below its oldest admitted protocol version, by name. An agent
//! that has not been updated cannot fix that from the page, and an agent older than the
//! refusal's code reports it only as a server that never answers. So the workspace UI, which
//! deploys from this same commit, shows such a user "update the Citadel agent" in place of its
//! outage notice (`citadel-workspaces/src/lib/reconnect/outdated-agent.ts`), and lists there
//! each protocol version it does that for.
//!
//! This test is what keeps a server build from raising that version without the UI: the
//! version this server is built with must be on the UI's list, and the list's claim must be
//! wired to the page a session's outage shows and held by its own test.

use citadel_sdk::prelude::OLDEST_PEER_PROTOCOL_VERSION;

const STEPS: &str = include_str!("../../citadel-workspaces/src/lib/reconnect/outdated-agent.ts");
const LOADER: &str =
    include_str!("../../citadel-workspaces/src/components/ui/workspace-loader.tsx");
const NOTICE: &str =
    include_str!("../../citadel-workspaces/src/components/outage/OutageNotice.tsx");
const NOTICE_TEST: &str = include_str!(
    "../../citadel-workspaces/src/components/outage/__tests__/an-outdated-agent-is-told-to-update.test.tsx"
);

/// The versions the UI's list names, as written there.
fn listed() -> Vec<String> {
    let list = STEPS
        .split_once("PROTOCOL_STEPS_WITH_AN_UPDATE_NOTICE: readonly string[] =")
        .and_then(|(_, rest)| rest.split_once('['))
        .and_then(|(_, rest)| rest.split_once(']'))
        .map(|(list, _)| list)
        .expect("outdated-agent.ts declares the list as an array literal");
    list.split(',')
        .map(|entry| entry.trim().trim_matches('\'').to_string())
        .filter(|entry| !entry.is_empty())
        .collect()
}

/// Control: take the version out of the UI's list, or build against an SDK that admits a
/// newer oldest version, and this fails.
#[test]
fn the_oldest_protocol_this_server_admits_is_one_the_ui_tells_old_agents_about() {
    let (major, minor, patch) = OLDEST_PEER_PROTOCOL_VERSION;
    let admitted = format!("{major}.{minor}.{patch}");
    assert!(
        listed().contains(&admitted),
        "this server refuses agents older than protocol {admitted}, and \
         citadel-workspaces/src/lib/reconnect/outdated-agent.ts does not list it (it lists \
         {:?}): users of older agents would be told the error is the service's",
        listed()
    );
}

/// Control: render `ServiceUnavailable` from the loader directly, and this fails.
#[test]
fn the_page_a_sessions_outage_shows_is_the_one_that_checks_the_agents_version() {
    assert!(
        LOADER.contains("<OutageNotice ") && !LOADER.contains("<ServiceUnavailable "),
        "workspace-loader.tsx must show an outage through OutageNotice"
    );
    assert!(
        NOTICE.contains("outageView(") && NOTICE.contains("releasedAgent"),
        "OutageNotice must decide from the site's released agent (lib/reconnect/outdated-agent.ts)"
    );
    assert!(
        NOTICE_TEST.contains("update-agent-notice") && NOTICE_TEST.contains("OUTAGE_TITLE"),
        "the UI test that holds the update notice is gone"
    );
}
