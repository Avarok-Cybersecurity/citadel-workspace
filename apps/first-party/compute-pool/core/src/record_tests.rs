use super::*;
use crate::dashboard;
use crate::jobs;
use crate::pool::Pool;
use citadel_app_sdk_types::calls::DrawCommand;
use citadel_app_sdk_types::{decode, encode};
use std::vec::Vec;

/// A record as the module wrote it before the check was kept.
#[derive(Serialize)]
struct Before {
    job_id: u64,
    job: Job,
    result: JobResult,
    verified: bool,
    ms: u32,
}

/// The history a member kept before this version still loads, every entry of it, and each one is
/// shown as "outcome not recorded": not dropped, and not called verified or local by a guess.
#[test]
fn a_history_written_before_the_check_was_kept_loads_and_says_its_outcome_was_not_recorded() {
    let job = Job::Primes { lo: 0, hi: 1_000 };
    let old = |job_id: u64, verified: bool| Before {
        job_id,
        job: job.clone(),
        result: jobs::run(&job).unwrap(),
        verified,
        ms: 40,
    };
    let bytes = encode(&[old(1, true), old(2, false)]);
    let history: Vec<Record> = decode(&bytes).expect("the old history still loads");
    let outcomes: Vec<Outcome> = history.iter().map(Record::outcome).collect();
    assert_eq!(outcomes, [Outcome::NotRecorded, Outcome::NotRecorded]);
    assert!(history.iter().all(|r| r.helpers.is_empty()));

    let mut pool = Pool::new("alice", 4);
    pool.joined();
    pool.history = history.into();
    let shown = dashboard::draw(&pool, 320.0, 240.0).into_iter().any(|c| {
        matches!(c, DrawCommand::FillText { text, .. } if text == "last job: 40 ms, outcome not recorded")
    });
    assert!(shown);
}

/// A record written now keeps its check: it reads back with the same outcome.
#[test]
fn a_record_written_now_reads_back_with_its_outcome() {
    let job = Job::Primes { lo: 0, hi: 1_000 };
    let record = Record {
        job_id: 3,
        result: jobs::run(&job).unwrap(),
        job,
        helpers: ["bob".into()].into(),
        check: Some(Check::Agreed),
        ms: 40,
    };
    let back: Record = decode(&encode(&record)).unwrap();
    assert_eq!((back.outcome(), back), (Outcome::Verified, record));
}
