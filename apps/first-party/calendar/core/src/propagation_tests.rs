//! `propagation`: down fans out to every descendant within the bound and only there, a private
//! event never propagates, a projection holds the allow-list and nothing else, up-pull shows an
//! event exactly between its origin and `up_to`, and a reader reconciles against the origin.

use crate::codec_tests::event;
use crate::model::{EventStatus, Visibility};
use crate::propagation::*;
use std::collections::BTreeSet;
use std::format;
use std::string::String;
use std::vec::Vec;

fn nodes(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("n{i}")).collect()
}

#[test]
fn down_projects_into_every_descendant_and_never_the_origin() {
    let mut e = event("e1");
    e.propagate.down = true;
    let mut subtree = nodes(3);
    subtree.push("eng".into());
    let plan = fan_out_plan(&e, &subtree).expect("planned");
    let targets: Vec<&str> = plan
        .iter()
        .map(|w| match w {
            Write::Put { node, key, .. } => {
                assert_eq!(key, "cal/inherit/eng/e1");
                node.as_str()
            }
            Write::Delete { .. } => panic!("a live event is put"),
        })
        .collect();
    assert_eq!(targets, ["n0", "n1", "n2"]);
}

#[test]
fn the_fan_out_bound_is_256_nodes() {
    let mut e = event("e1");
    e.propagate.down = true;
    assert_eq!(
        fan_out_plan(&e, &nodes(MAX_FAN_OUT))
            .expect("at the bound")
            .len(),
        256
    );
    assert_eq!(
        fan_out_plan(&e, &nodes(MAX_FAN_OUT + 1)),
        Err(PropagationError::TooManyNodes { count: 257 })
    );
}

#[test]
fn a_cancelled_or_withdrawn_event_deletes_its_projections() {
    let mut e = event("e1");
    e.propagate.down = true;
    e.status = EventStatus::Cancelled {
        by: "ana".into(),
        reason: None,
    };
    assert!(fan_out_plan(&e, &nodes(2))
        .expect("planned")
        .iter()
        .all(|w| matches!(w, Write::Delete { .. })));
    let mut e = event("e1");
    e.propagate.down = false;
    assert!(fan_out_plan(&e, &nodes(2))
        .expect("planned")
        .iter()
        .all(|w| matches!(w, Write::Delete { .. })));
}

#[test]
fn a_private_event_never_propagates() {
    let mut e = event("e1");
    e.visibility = Visibility::Private;
    e.propagate.down = true;
    assert_eq!(
        fan_out_plan(&e, &nodes(1)),
        Err(PropagationError::PrivateCannotPropagate)
    );
    e.propagate.down = false;
    e.propagate.up_to = Some("company".into());
    assert_eq!(
        check_propagation(&e),
        Err(PropagationError::PrivateCannotPropagate)
    );
    e.propagate.up_to = None;
    assert_eq!(project(&e), Err(PropagationError::PrivateCannotPropagate));
}

/// The projection's stored fields are exactly the allow-list: adding one (a body, the invitees)
/// turns this red.
#[test]
fn a_projection_carries_the_allow_list_and_nothing_else() {
    let mut e = event("e1");
    e.propagate.down = true;
    let bytes = citadel_app_sdk_types::encode(&project(&e).expect("projected"));
    let map: std::collections::BTreeMap<String, serde::de::IgnoredAny> =
        citadel_app_sdk_types::decode(&bytes).expect("a map");
    let fields: BTreeSet<&str> = map.keys().map(String::as_str).collect();
    let allowed = BTreeSet::from([
        "title",
        "when",
        "zone",
        "location",
        "hosts",
        "origin_node",
        "origin_rev",
    ]);
    assert_eq!(fields, allowed);
    e.visibility = Visibility::BusyOnly;
    assert_eq!(
        project(&e).expect("projected").title,
        None,
        "busy-only carries no title"
    );
}

#[test]
fn up_pull_shows_an_event_between_its_origin_and_up_to_only() {
    let mut e = event("e1");
    e.origin_node = "team".into();
    e.propagate.up_to = Some("eng".into());
    let chain = |c: &[&str]| -> Vec<String> { c.iter().map(|s| String::from(*s)).collect() };
    assert!(shown_up_at(&e, &chain(&["eng", "company"])));
    assert!(
        shown_up_at(&e, &chain(&["platform", "eng", "company"])),
        "a node between them"
    );
    assert!(!shown_up_at(&e, &chain(&["company"])), "above up_to");
    assert!(
        !shown_up_at(&e, &chain(&["team", "eng", "company"])),
        "the origin shows its own"
    );
    assert!(!shown_up_at(&e, &[]));
    let many = nodes(MAX_UP_PULL + 4);
    let (targets, more) = up_pull_targets(&many);
    assert_eq!((targets.len(), more), (256, true));
}

#[test]
fn a_reader_reconciles_a_projection_with_what_it_can_read_of_the_origin() {
    let mut e = event("e1");
    e.propagate.down = true;
    let p = project(&e).expect("projected");
    assert_eq!(reconcile(&p, None), Reconciled::ShowWithoutLink);
    assert_eq!(reconcile(&p, Some(None)), Reconciled::Hide);
    assert_eq!(reconcile(&p, Some(Some(&e))), Reconciled::Show);
    let mut newer = e.clone();
    newer.rev = 2;
    assert_eq!(reconcile(&p, Some(Some(&newer))), Reconciled::Stale);
    newer.status = EventStatus::Cancelled {
        by: "ana".into(),
        reason: None,
    };
    assert_eq!(reconcile(&p, Some(Some(&newer))), Reconciled::Hide);
}
