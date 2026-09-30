//! Who is in a node: everyone listed on it, and everyone who reaches it through a
//! level above.
//!
//! `ListMembers` returned the node's own `members` only, while access inherits:
//! `is_member_of_domain` walks up to the workspace, so a workspace member reads
//! and posts in every office below it and was listed in none of them (live,
//! 2026-09-29). The owner's rule: anyone with access to a node sees everyone
//! else with access, and those who come through a level above are marked with it.
//!
//! Pure. The caller supplies the path and each level's members, and filters the
//! result by permission; nothing here reads storage.

/// One person on a node's roster.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RosterEntry {
    pub user_id: String,
    /// The nearest level above whose membership gives this person access, or
    /// `None` when they are listed on the node itself.
    pub via: Option<String>,
}

/// The roster of the last element of `path`.
///
/// `path` runs from the top level (the workspace) down to the node, as
/// `TreeValidator::get_path_to_root` returns it. The node's own members come
/// first; then each level above, nearest first, adds whoever is not already
/// listed, tagged with that level. Duplicates collapse onto the nearest level.
pub(crate) fn effective_roster(
    path: &[String],
    members_of: impl Fn(&str) -> Vec<String>,
) -> Vec<RosterEntry> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut roster: Vec<RosterEntry> = Vec::new();
    let Some((target, above)) = path.split_last() else {
        return roster;
    };
    let levels = std::iter::once((target, None))
        .chain(above.iter().rev().map(|level| (level, Some(level.clone()))));
    for (level, via) in levels {
        for user_id in members_of(level) {
            if seen.insert(user_id.clone()) {
                roster.push(RosterEntry {
                    user_id,
                    via: via.clone(),
                });
            }
        }
    }
    roster
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn path(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    fn members(table: &[(&str, &[&str])]) -> impl Fn(&str) -> Vec<String> {
        let map: HashMap<String, Vec<String>> = table
            .iter()
            .map(|(level, ids)| {
                (
                    level.to_string(),
                    ids.iter().map(|s| s.to_string()).collect(),
                )
            })
            .collect();
        move |level: &str| map.get(level).cloned().unwrap_or_default()
    }

    fn entry(user_id: &str, via: Option<&str>) -> RosterEntry {
        RosterEntry {
            user_id: user_id.to_string(),
            via: via.map(str::to_string),
        }
    }

    #[test]
    fn an_office_lists_the_workspace_members_who_reach_it() {
        // The live case: an office with no members of its own.
        let roster = effective_roster(
            &path(&["ws", "office"]),
            members(&[("ws", &["thomas", "john"])]),
        );
        assert_eq!(
            roster,
            vec![entry("thomas", Some("ws")), entry("john", Some("ws"))]
        );
    }

    #[test]
    fn the_nodes_own_members_come_first_and_are_not_marked() {
        let roster = effective_roster(
            &path(&["ws", "office"]),
            members(&[("ws", &["thomas", "john"]), ("office", &["john"])]),
        );
        assert_eq!(
            roster,
            vec![entry("john", None), entry("thomas", Some("ws"))]
        );
    }

    #[test]
    fn inherited_members_are_marked_with_the_nearest_level() {
        let roster = effective_roster(
            &path(&["ws", "office", "room"]),
            members(&[
                ("ws", &["ann", "bea"]),
                ("office", &["bea"]),
                ("room", &["cai"]),
            ]),
        );
        assert_eq!(
            roster,
            vec![
                entry("cai", None),
                entry("bea", Some("office")),
                entry("ann", Some("ws"))
            ]
        );
    }

    #[test]
    fn the_workspace_itself_is_all_direct() {
        let roster = effective_roster(&path(&["ws"]), members(&[("ws", &["thomas"])]));
        assert_eq!(roster, vec![entry("thomas", None)]);
    }

    #[test]
    fn an_empty_path_has_nobody() {
        assert!(effective_roster(&[], members(&[])).is_empty());
    }
}
