//! Every group-message notification goes out membership-filtered.
//!
//! `broadcast_to_group` exists because a message in a private room used to be
//! pushed to every connected session regardless of membership. It was applied
//! to `SendGroupMessage` and to nothing else: `EditGroupMessage` — which
//! carries the full new content — and `DeleteGroupMessage` both kept the
//! unscoped `broadcast`, so the filter was bypassed on two of the three write
//! paths for eleven rounds.
//!
//! That is this repo's most productive defect: a correct fix applied in one
//! place. The frontend has a guard for the mirror-image case
//! (`BROADCAST_WRITES` in the workspace-service tests); it cannot see Rust.
//!
//! A source scan rather than a behavioural test because the alternative is a
//! full kernel with two sessions and a membership boundary, and the property
//! worth pinning is textual: which broadcast function each arm calls.

use std::fs;
use std::path::Path;

/// Notifications that carry group content or name a group.
const GROUP_NOTIFICATIONS: &[&str] = &[
    "GroupMessageNotification",
    "GroupMessageEdited",
    "GroupMessageDeleted",
];

#[test]
fn every_group_notification_is_broadcast_to_the_group() {
    let path = Path::new("src/kernel/command_processor/async_process_command.rs");
    let source = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));

    for notification in GROUP_NOTIFICATIONS {
        let Some(start) = source.find(notification) else {
            panic!(
                "{notification} is not constructed in {} — this scan is checking \
                 nothing. Update GROUP_NOTIFICATIONS or the path.",
                path.display()
            );
        };

        // The construction and the broadcast that follows it, bounded well
        // short of the next arm so a neighbour's call cannot satisfy this.
        let window = &source[start..source.len().min(start + 1200)];

        let scoped = window.find("broadcast_to_group");
        let unscoped = window
            .match_indices("kernel.broadcast(")
            .map(|(i, _)| i)
            .next();

        match (scoped, unscoped) {
            (Some(_), None) => {}
            (Some(s), Some(u)) if s < u => {}
            _ => panic!(
                "{notification} is broadcast with the unscoped `kernel.broadcast`. \
                 Use `broadcast_to_group(notification, requester_cid, group_id)` — \
                 the membership filter is the whole point, and it has already been \
                 left uncopied once."
            ),
        }
    }
}
