use crate::group_chat::*;

const ALICE: u64 = 11;
const BOB: u64 = 22;

fn change(emoji: &str, reactor_cid: u64, on: bool, at: u64) -> ReactionChange<'_> {
    ReactionChange {
        emoji,
        reactor_cid,
        on,
        at,
    }
}

#[test]
fn an_add_records_the_reactor_once() {
    let once = apply_reaction(&[], &change("👍", ALICE, true, 5)).expect("allowed");
    let twice = apply_reaction(&once, &change("👍", ALICE, true, 6)).expect("allowed");
    assert_eq!(
        twice.len(),
        1,
        "a second add by the same reactor made a second entry"
    );
    assert!(twice[0].active);
}

#[test]
fn a_retraction_touches_only_the_reactors_own_entry() {
    let both = apply_reaction(
        &apply_reaction(&[], &change("👍", ALICE, true, 1)).unwrap(),
        &change("👍", BOB, true, 2),
    )
    .unwrap();
    let after = apply_reaction(&both, &change("👍", BOB, false, 3)).unwrap();
    let alice = after.iter().find(|r| r.reactor_cid == ALICE).unwrap();
    let bob = after.iter().find(|r| r.reactor_cid == BOB).unwrap();
    assert!(alice.active, "Bob's retraction removed Alice's reaction");
    assert!(!bob.active);
}

#[test]
fn retracting_what_was_never_there_changes_nothing() {
    assert!(apply_reaction(&[], &change("👍", ALICE, false, 1))
        .unwrap()
        .is_empty());
}

#[test]
fn an_emoji_outside_the_set_is_refused() {
    assert!(apply_reaction(&[], &change("<script>", ALICE, true, 1)).is_err());
}

#[test]
fn an_entrys_clock_never_goes_back() {
    let added = apply_reaction(&[], &change("🎉", ALICE, true, 50)).unwrap();
    let stale = apply_reaction(&added, &change("🎉", ALICE, false, 10)).unwrap();
    assert_eq!(stale[0].at, 50);
}
