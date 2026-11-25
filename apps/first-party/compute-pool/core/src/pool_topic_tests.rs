use super::*;
use crate::dashboard;
use crate::jobs::Job;
use crate::limits::{CLAIM_WINDOW_MS, JOIN_RETRY_MS};
use crate::pool::{Action, Outcome};
use crate::wire::{work, PoolMsg};
use citadel_app_sdk_types::calls::{DrawCommand, Via};
use std::{string::String, vec::Vec};

fn logged(actions: &[Action]) -> Vec<String> {
    let line = |a: &Action| match a {
        Action::Log(l) => Some(l.clone()),
        _ => None,
    };
    actions.iter().filter_map(line).collect()
}

fn shown(pool: &Pool) -> Vec<String> {
    let text = |c: DrawCommand| match c {
        DrawCommand::FillText { text, .. } => Some(text),
        _ => None,
    };
    dashboard::draw(pool, 320.0, 240.0)
        .into_iter()
        .filter_map(text)
        .collect()
}

#[test]
fn a_member_is_logged_the_first_time_it_is_heard_and_not_again() {
    let mut alice = Pool::new("alice", 4);
    let beat = PoolMsg::Heartbeat { cores: 2, load: 0 };
    assert_eq!(
        logged(&alice.on_msg("bob", beat.clone())),
        ["member bob is here"]
    );
    assert!(logged(&alice.on_msg("bob", beat)).is_empty());
}

#[test]
fn a_failed_open_is_said_shown_and_tried_again_after_the_retry_interval() {
    let mut pool = Pool::new("alice", 4);
    assert!(shown(&pool).iter().any(|t| t == "joining the pool…"));
    let said = pool.join_failed("Refused(Unavailable(\"topic\"))");
    assert_eq!(
        logged(&said),
        ["not in the pool: Refused(Unavailable(\"topic\")); trying again in 10 s"]
    );
    assert!(shown(&pool)
        .iter()
        .any(|t| t.starts_with("not in the pool (")));
    assert!(!pool.tick(JOIN_RETRY_MS - 1).contains(&Action::JoinTopic));
    assert!(pool.tick(1).contains(&Action::JoinTopic));
    assert_eq!(pool.membership, Membership::Joining);
    assert!(
        !pool.tick(JOIN_RETRY_MS).contains(&Action::JoinTopic),
        "one try per failure"
    );
}

/// A job a member answered and checked, and one this device did alone, read differently in the
/// log line and on the dashboard: "verified" is never said of work nobody else did.
#[test]
fn a_local_job_and_a_members_verified_job_are_told_apart_in_the_log_and_on_the_dashboard() {
    let job = Job::Primes { lo: 0, hi: 80_000 };
    let mut alone = Pool::new("solo", 1);
    alone.joined();
    alone.run(job.clone()).unwrap();
    let out = alone.tick(CLAIM_WINDOW_MS);
    assert!(logged(&out)[0].ends_with(": computed on this device"));
    assert!(shown(&alone)
        .iter()
        .any(|t| t.ends_with(", computed on this device")));

    let mut helped = Pool::new("alice", 4);
    helped.joined();
    let announced = helped.run(job).unwrap();
    let Some(Action::Publish(PoolMsg::Announce { job_id, .. })) = announced.first().cloned() else {
        panic!("{announced:?}")
    };
    helped.on_msg("bob", PoolMsg::Claim { job_id });
    let assignment = helped
        .tick(CLAIM_WINDOW_MS)
        .into_iter()
        .find_map(|a| match a {
            Action::Fanout { assignment, .. } => Some(assignment),
            _ => None,
        })
        .expect("bob claimed");
    helped.answered("bob", Ok(work("bob", &assignment).unwrap()), Via::P2p);
    let out = helped.finish();
    assert!(logged(&out)[0].ends_with(": verified"));
    assert!(shown(&helped).iter().any(|t| t.ends_with(", verified")));
    let outcomes: Vec<Outcome> = [&alone, &helped]
        .iter()
        .map(|p| p.history[0].outcome())
        .collect();
    assert_eq!(outcomes, [Outcome::Local, Outcome::Verified]);
}
