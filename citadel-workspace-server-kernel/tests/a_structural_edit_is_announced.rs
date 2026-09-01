//! Every structural field of `UpdateNode` must be both gated and broadcast.
//!
//! Two call sites needed the same answer and each kept its own copy of the
//! field list: the permission gate in `async_node_ops::update_node`, choosing
//! between `EditTreeStructure` and `EditMdx`, and the command processor,
//! choosing whether to broadcast the changed node to the rest of the workspace.
//!
//! They drifted. `is_default` was added to the request, honoured by the writer
//! and included in the permission gate — and never added to the broadcast
//! condition. So "Set as default" was applied on the server, acknowledged to the
//! caller, and announced to nobody: every other client kept its old default
//! until it reloaded. The setting worked for exactly one person at a time.
//!
//! The list now lives once, in `update_changes_structure`. These assert that
//! both sites ask it, and that it answers for every field.

use citadel_workspace_server_kernel::handlers::domain::node_ops::update_changes_structure;

#[test]
fn every_structural_field_counts_as_structural() {
    assert!(
        update_changes_structure(Some("n"), None, None, None, None),
        "name"
    );
    assert!(
        update_changes_structure(None, Some("d"), None, None, None),
        "description"
    );
    assert!(
        update_changes_structure(None, None, Some("r"), None, None),
        "rules"
    );
    assert!(
        update_changes_structure(None, None, None, Some(true), None),
        "chat_enabled"
    );

    // The one that was missing. Both true and false: clearing the default is as
    // structural as setting it, and leaves the workspace opening somewhere else.
    assert!(
        update_changes_structure(None, None, None, None, Some(true)),
        "is_default=true must be structural — it decides where the workspace opens \
         and it writes to every other node"
    );
    assert!(
        update_changes_structure(None, None, None, None, Some(false)),
        "is_default=false must be structural"
    );
}

#[test]
fn a_content_only_edit_is_not_structural() {
    // Otherwise every document save would demand EditTreeStructure — which
    // `Permission::for_role` never grants to a Custom role — and would broadcast
    // the whole node on every keystroke-save.
    assert!(
        !update_changes_structure(None, None, None, None, None),
        "an mdx-only update must stay non-structural"
    );
}

/// Both decisions must come from the one predicate, not from a local copy.
#[test]
fn both_call_sites_ask_the_shared_predicate() {
    let sites: [(&str, &str); 2] = [
        (
            "permission gate",
            include_str!("../src/handlers/domain/async_ops/async_node_ops.rs"),
        ),
        (
            "broadcast decision",
            include_str!("../src/kernel/command_processor/async_process_command.rs"),
        ),
    ];

    for (label, source) in sites {
        let code: String = source
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        assert!(
            code.contains("update_changes_structure("),
            "the {label} no longer calls update_changes_structure, so it is \
             deciding from its own copy of the field list again — which is how \
             is_default came to be gated but never broadcast."
        );

        // And no hand-rolled copy beside it. The original broadcast condition
        // was literally this chain.
        assert!(
            !code.contains("|| chat_enabled.is_some()"),
            "the {label} still contains a hand-written structural-field chain; \
             one of the two lists will drift from the other again."
        );
    }
}
