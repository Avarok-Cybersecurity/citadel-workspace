use super::*;

fn job() -> Job {
    Job::Primes { lo: 0, hi: 80_000 }
}

fn published(actions: &[Action]) -> Vec<PoolMsg> {
    actions
        .iter()
        .filter_map(|a| match a {
            Action::Publish(m) => Some(m.clone()),
            _ => None,
        })
        .collect()
}

fn logged(actions: &[Action]) -> Vec<String> {
    actions
        .iter()
        .filter_map(|a| match a {
            Action::Log(line) => Some(line.clone()),
            _ => None,
        })
        .collect()
}

/// alice runs a job; bob and carol claim it; the claim window closes and the chunks go out.
fn dispatched(alice: &mut Pool) -> Assignment {
    let announced = alice.run(job()).unwrap();
    let [PoolMsg::Announce {
        job_id,
        chunks: CHUNKS,
    }] = published(&announced)[..]
    else {
        panic!("{announced:?}")
    };
    for who in ["bob", "carol"] {
        assert!(alice.on_msg(who, PoolMsg::Claim { job_id }).is_empty());
    }
    let out = alice.tick(CLAIM_WINDOW_MS);
    let fanout = out.iter().find_map(|a| match a {
        Action::Fanout {
            targets,
            assignment,
        } => Some((targets.clone(), assignment.clone())),
        _ => None,
    });
    let (targets, assignment) = fanout.expect("dispatched when the window closed");
    assert_eq!(targets, ["bob", "carol"]);
    assignment
}

#[test]
fn a_member_heartbeats_on_its_first_tick_and_then_every_interval() {
    let mut pool = Pool::new("alice", 4);
    let beat = PoolMsg::Heartbeat { cores: 4, load: 0 };
    assert_eq!(published(&pool.tick(16)), std::slice::from_ref(&beat));
    assert!(published(&pool.tick(HEARTBEAT_MS - 1)).is_empty());
    assert_eq!(published(&pool.tick(1)), [beat]);
}

/// Jobs run back to back, as the Compute Pool spec runs them: no second of this member's own
/// time ever carries more messages than the topic admits, heartbeats included.
#[test]
fn back_to_back_jobs_never_publish_over_the_topic_rate() {
    let mut pool = Pool::new("alice", 4);
    let mut sent: Vec<u64> = Vec::new();
    let mut now: u64 = 0;
    while now < 60_000 {
        let mut out = pool.tick(16);
        now += 16;
        if pool.progress().is_none() {
            out.extend(pool.run(job()).unwrap());
        }
        sent.extend(published(&out).iter().map(|_| now));
    }
    let worst = sent
        .iter()
        .map(|&t| sent.iter().filter(|&&u| u >= t && u < t + 1000).count())
        .max()
        .unwrap();
    assert!(sent.len() > 40, "jobs ran: {}", sent.len());
    assert!(
        worst <= TOPIC_MAX_MSGS_PER_S as usize,
        "{worst} messages in one second"
    );
}

#[test]
fn an_announcement_is_claimed_and_a_claim_after_the_window_is_ignored() {
    let mut bob = Pool::new("bob", 2);
    let claim = bob.on_msg(
        "alice",
        PoolMsg::Announce {
            job_id: 7,
            chunks: 8,
        },
    );
    assert_eq!(published(&claim), [PoolMsg::Claim { job_id: 7 }]);
    assert!(
        bob.peers.contains_key("alice"),
        "a message is a sign of life"
    );
    let mut alice = Pool::new("alice", 4);
    let a = dispatched(&mut alice);
    alice.on_msg("dave", PoolMsg::Claim { job_id: a.job_id });
    let workers: BTreeSet<&str> = a.assign.iter().map(|(w, _)| w.as_str()).collect();
    assert_eq!(workers, ["bob", "carol"].into(), "dave claimed too late");
    assert_eq!(a.assign.len(), CHUNKS as usize);
    assert!(alice.run(job()).is_none(), "one job at a time");
}

#[test]
fn honest_workers_give_the_whole_answer_verified_and_it_is_saved_and_gossiped() {
    let mut alice = Pool::new("alice", 4);
    let a = dispatched(&mut alice);
    for who in ["bob", "carol"] {
        alice.tick(40);
        let said = alice.answered(who, Ok(work(who, &a).unwrap()), Via::P2p);
        let line = alloc::format!("answer from {who} via p2p: 4 chunk(s)");
        assert_eq!(logged(&said), [line]);
    }
    assert_eq!(alice.peers["bob"].via, Some(Via::P2p));
    assert_eq!(alice.peers["carol"].rtt_ms, Some(80));
    let out = alice.finish();
    let Some(Action::Save(record)) = out.last() else {
        panic!("{out:?}")
    };
    assert_eq!(record.result, jobs::run(&job()).unwrap());
    assert!(record.verified);
    assert!(matches!(published(&out)[..], [PoolMsg::Done { .. }]));
    let line = alloc::format!(
        "job {:x} done in {} ms: verified",
        a.job_id,
        CLAIM_WINDOW_MS + 80
    );
    assert_eq!(logged(&out), [line]);
    assert_eq!(alice.history.len(), 1);
    assert!(alice.run(job()).is_some(), "free for the next job");
}

#[test]
fn a_wrong_answer_on_the_checked_chunk_is_caught_and_replaced() {
    let mut alice = Pool::new("alice", 4);
    let a = dispatched(&mut alice);
    let checked = jobs::spot_check(a.job_id, CHUNKS as usize).unwrap() as u32;
    let (cheat, _) = a.assign[checked as usize].clone();
    for who in ["bob", "carol"] {
        let mut answers = work(who, &a).unwrap();
        if who == cheat {
            for (i, r) in answers.iter_mut() {
                if *i == checked {
                    *r = JobResult::Primes { count: 0 };
                }
            }
        }
        alice.answered(who, Ok(answers), Via::Relay);
    }
    let out = alice.finish();
    let Some(Action::Save(record)) = out.last() else {
        panic!("{out:?}")
    };
    assert!(!record.verified);
    let line = alloc::format!(
        "job {:x} done in {CLAIM_WINDOW_MS} ms: wrong answer",
        a.job_id
    );
    assert_eq!(logged(&out), [line]);
    assert_eq!(
        record.result,
        jobs::run(&job()).unwrap(),
        "the checked chunk is recomputed"
    );
    assert_eq!(alice.peers[&cheat].last.as_deref(), Some("wrong answer"));
}

#[test]
fn chunks_nobody_answered_are_computed_here_and_with_no_claimants_all_of_them() {
    let mut alice = Pool::new("alice", 4);
    let a = dispatched(&mut alice);
    alice.answered("bob", Ok(work("bob", &a).unwrap()), Via::P2p);
    let said = alice.answered("carol", Err("NoHost".into()), Via::Relay);
    assert_eq!(logged(&said), ["answer from carol via relay: NoHost"]);
    let out = alice.finish();
    let Some(Action::Save(record)) = out.last() else {
        panic!("{out:?}")
    };
    assert_eq!(record.result, jobs::run(&job()).unwrap());
    assert_eq!(alice.peers["carol"].last.as_deref(), Some("NoHost"));
}

#[test]
fn a_silent_peer_leaves_the_dashboard_and_the_history_keeps_the_last_fifty() {
    let mut alice = Pool::new("alice", 4);
    alice.on_msg("bob", PoolMsg::Heartbeat { cores: 8, load: 0 });
    alice.tick(PEER_STALE_MS as u32 + 1);
    assert!(alice.peers.is_empty());
    for _ in 0..HISTORY_LEN + 3 {
        alice.run(Job::ShaChain { seed: 1, n: 1 }).unwrap();
        alice.tick(CLAIM_WINDOW_MS);
    }
    assert_eq!(alice.history.len(), HISTORY_LEN);
    assert_eq!(
        alice.history.back().unwrap().job_id & 0xffff_ffff,
        HISTORY_LEN as u64 + 3
    );
}

/// With nobody claiming, the window's close does the whole job here and finishes it: nothing
/// else will (no fan-out, so no `done`), and the next Run is accepted.
#[test]
fn with_no_claimants_the_job_finishes_when_the_window_closes() {
    let mut solo = Pool::new("solo", 1);
    solo.run(job()).unwrap();
    let out = solo.tick(CLAIM_WINDOW_MS);
    assert!(
        !out.iter().any(|a| matches!(a, Action::Fanout { .. })),
        "nobody to call"
    );
    let Some(Action::Save(record)) = out.last() else {
        panic!("{out:?}")
    };
    assert_eq!(record.result, jobs::run(&job()).unwrap());
    assert!(solo.progress().is_none());
    assert!(solo.run(job()).is_some(), "a new Run is accepted");
}
