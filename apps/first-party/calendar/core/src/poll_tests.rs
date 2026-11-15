//! `poll`: a poll's proposals are ordered and bounded; a vote names each proposal at most once
//! and only on an open poll; the tally counts only votes that pass, by name; the leader is most
//! yes, then most maybe, then the earliest; a pick closes the poll to further picks.

use crate::poll::*;
use crate::slots::Interval;
use crate::tz::Zone;
use std::string::String;
use std::vec;
use std::vec::Vec;

const HOUR: i64 = 3_600_000;

fn slot(h: i64) -> Interval {
    Interval {
        start_ms: h * HOUR,
        end_ms: h * HOUR + HOUR,
    }
}

fn poll() -> Poll {
    Poll {
        id: "p1".into(),
        type_id: "t".into(),
        host: "ana".into(),
        title: "Planning".into(),
        zone: Zone::new("Europe/Berlin").expect("a zone"),
        proposals: vec![slot(10), slot(12), slot(14)],
        state: PollState::Open,
    }
}

fn vote(yes: &[u16], maybe: &[u16]) -> PollVote {
    PollVote {
        poll_id: "p1".into(),
        yes: yes.to_vec(),
        maybe: maybe.to_vec(),
    }
}

#[test]
fn proposals_are_ordered_bounded_and_never_overlap() {
    assert_eq!(check_poll(&poll()), Ok(()));
    let overlap = Poll {
        proposals: vec![
            slot(10),
            Interval {
                start_ms: 10 * HOUR + 1,
                end_ms: 12 * HOUR,
            },
        ],
        ..poll()
    };
    let backwards = Poll {
        proposals: vec![slot(12), slot(10)],
        ..poll()
    };
    let empty_slot = Poll {
        proposals: vec![Interval {
            start_ms: HOUR,
            end_ms: HOUR,
        }],
        ..poll()
    };
    let none = Poll {
        proposals: vec![],
        ..poll()
    };
    let many = Poll {
        proposals: (0..=MAX_PROPOSALS as i64).map(|h| slot(2 * h)).collect(),
        ..poll()
    };
    for bad in [overlap, backwards, empty_slot, none, many] {
        assert_eq!(
            check_poll(&bad),
            Err(PollError::BadProposals),
            "{:?}",
            bad.proposals
        );
    }
}

#[test]
fn a_vote_names_each_proposal_once_on_an_open_poll() {
    assert_eq!(check_vote(&poll(), &vote(&[0, 2], &[1])), Ok(()));
    assert_eq!(
        check_vote(&poll(), &vote(&[0], &[0])),
        Err(PollError::BadVote)
    );
    assert_eq!(
        check_vote(&poll(), &vote(&[3], &[])),
        Err(PollError::BadVote)
    );
    let elsewhere = PollVote {
        poll_id: "p2".into(),
        ..vote(&[0], &[])
    };
    assert_eq!(check_vote(&poll(), &elsewhere), Err(PollError::BadVote));
    let closed = Poll {
        state: PollState::Closed,
        ..poll()
    };
    assert_eq!(
        check_vote(&closed, &vote(&[0], &[])),
        Err(PollError::NotOpen)
    );
}

#[test]
fn the_tally_counts_only_votes_that_pass_and_names_each_voter_once() {
    let votes: Vec<(String, PollVote)> = vec![
        ("cy".into(), vote(&[1], &[0])),
        ("bo".into(), vote(&[1, 2], &[])),
        ("bad".into(), vote(&[1, 1], &[])),
        ("ed".into(), vote(&[9], &[])),
    ];
    let t = tally(&poll(), &votes);
    assert_eq!(
        t.iter().map(|p| p.yes.clone()).collect::<Vec<_>>(),
        vec![
            vec![],
            vec!["bo".to_string(), "cy".to_string()],
            vec!["bo".to_string()]
        ]
    );
    assert_eq!(t[0].maybe, vec!["cy".to_string()]);
    // A picked poll is still tallied: what it was picked from stays readable.
    let picked = Poll {
        state: PollState::Picked {
            proposal: 1,
            event_id: "e".into(),
        },
        ..poll()
    };
    assert_eq!(tally(&picked, &votes), t);
}

#[test]
fn the_leader_is_most_yes_then_most_maybe_then_the_earliest() {
    let t = |rows: &[(usize, usize)]| -> Vec<ProposalTally> {
        rows.iter()
            .enumerate()
            .map(|(i, (y, m))| ProposalTally {
                proposal: i as u16,
                yes: (0..*y).map(|n| format!("y{n}")).collect(),
                maybe: (0..*m).map(|n| format!("m{n}")).collect(),
            })
            .collect()
    };
    assert_eq!(leading(&t(&[(1, 0), (2, 0), (2, 0)])), Some(1));
    assert_eq!(leading(&t(&[(1, 0), (1, 2), (1, 1)])), Some(1));
    assert_eq!(leading(&t(&[(0, 0), (0, 0)])), None);
}

#[test]
fn a_pick_turns_an_open_poll_into_its_slot_once() {
    let (picked, at) = pick(&poll(), 2, "e1".into()).expect("picked");
    assert_eq!(at, slot(14));
    assert_eq!(
        picked.state,
        PollState::Picked {
            proposal: 2,
            event_id: "e1".into()
        }
    );
    assert_eq!(pick(&picked, 0, "e2".into()), Err(PollError::NotOpen));
    assert_eq!(pick(&poll(), 3, "e3".into()), Err(PollError::BadVote));
}
