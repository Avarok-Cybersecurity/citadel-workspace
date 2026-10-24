//! `storage_authored`: authorship comes from the session, the roster follows what each author
//! holds, and a cross-author page is complete, ordered and resumable.

use super::storage::{KvIndex, Namespace, StorageRefusal, KV_LIST_PAGE};
use super::storage_authored::*;

fn index(keys: &[&str]) -> KvIndex {
    KvIndex {
        keys: keys.iter().map(|k| (k.to_string(), 1)).collect(),
    }
}

fn authored(node: &str, author: &str) -> Namespace {
    Namespace::NodeAuthored {
        node: node.into(),
        author: author.into(),
    }
}

#[test]
fn a_write_lands_in_the_caller_s_own_namespace_and_naming_another_is_refused() {
    let own = authored_namespace("room", None, "ana", Access::Write);
    assert_eq!(own, Ok(authored("room", "ana")));
    let same = authored_namespace("room", Some("ana"), "ana", Access::Write);
    assert_eq!(same, Ok(authored("room", "ana")));
    let forged = authored_namespace("room", Some("bob"), "ana", Access::Write);
    assert_eq!(forged, Err(StorageRefusal::Policy("author")));
}

#[test]
fn a_read_may_name_any_author_or_none_for_one_s_own() {
    let other = authored_namespace("room", Some("bob"), "ana", Access::Read);
    assert_eq!(other, Ok(authored("room", "bob")));
    let own = authored_namespace("room", None, "ana", Access::Read);
    assert_eq!(own, Ok(authored("room", "ana")));
    let bad = authored_namespace("room", Some("b\nob"), "ana", Access::Read);
    assert_eq!(bad, Err(StorageRefusal::Policy("bad_author")));
}

#[test]
fn an_author_is_on_the_roster_exactly_while_they_hold_a_key() {
    let empty = KvIndex::default();
    let joined = roster_after(&empty, "ana", &index(&["cal/rsvp/1"])).expect("added");
    assert!(joined.keys.contains_key("ana"));
    assert_eq!(roster_after(&joined, "ana", &index(&["cal/rsvp/2"])), None);
    let left = roster_after(&joined, "ana", &empty).expect("removed");
    assert!(left.keys.is_empty());
    assert_eq!(roster_after(&empty, "ana", &empty), None);
}

#[test]
fn a_cursor_round_trips_and_a_malformed_one_is_refused() {
    let cursor = encode_cursor("ana", "cal/event/7");
    assert_eq!(decode_cursor(&cursor), Ok(("ana", "cal/event/7")));
    assert_eq!(
        decode_cursor("no-newline"),
        Err(StorageRefusal::Policy("bad_cursor"))
    );
    assert_eq!(
        decode_cursor("\nkey"),
        Err(StorageRefusal::Policy("bad_cursor"))
    );
}

fn page_all(roster: &KvIndex, by: &[(&str, KvIndex)], prefix: &str) -> Vec<(String, String)> {
    let mut seen = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let parsed = cursor.as_deref().map(|c| decode_cursor(c).expect("ours"));
        let mut pager = AuthoredPager::new(prefix, parsed);
        for author in authors_from(roster, parsed) {
            let held = &by.iter().find(|(a, _)| *a == author).expect("listed").1;
            if pager.take(author, held) {
                break;
            }
        }
        let page = pager.finish();
        assert!(page.entries.len() <= KV_LIST_PAGE);
        seen.extend(page.entries.into_iter().map(|e| (e.author, e.key)));
        match page.next {
            Some(next) => cursor = Some(next),
            None => return seen,
        }
    }
}

#[test]
fn every_author_s_keys_are_listed_once_in_order_across_pages() {
    let many: Vec<String> = (0..150).map(|i| format!("cal/event/{i:03}")).collect();
    let many: Vec<&str> = many.iter().map(String::as_str).collect();
    let by = [
        ("ana", index(&many)),
        ("bob", index(&["cal/rsvp/1", "other/x", "sys/topic/cal"])),
        ("cy", index(&["cal/busy/2026-W41"])),
    ];
    let roster = index(&["ana", "bob", "cy"]);
    let seen = page_all(&roster, &by, "cal/");
    assert_eq!(seen.len(), 152, "150 + bob's one cal key + cy's");
    let mut sorted = seen.clone();
    sorted.sort();
    assert_eq!(seen, sorted, "by author, then key");
    assert!(seen.contains(&("bob".into(), "cal/rsvp/1".into())));
    assert!(!seen
        .iter()
        .any(|(_, k)| k.starts_with("sys/") || k == "other/x"));
}

#[test]
fn a_page_that_ends_exactly_at_the_last_key_has_no_next() {
    let exact: Vec<String> = (0..KV_LIST_PAGE).map(|i| format!("k{i:03}")).collect();
    let exact: Vec<&str> = exact.iter().map(String::as_str).collect();
    let mut pager = AuthoredPager::new("k", None);
    assert!(!pager.take("ana", &index(&exact)));
    let page = pager.finish();
    assert_eq!(page.entries.len(), KV_LIST_PAGE);
    assert_eq!(page.next, None);
}
