use super::*;

/// The prime-counting function at known points (OEIS A006880, A007053).
#[test]
fn prime_counts_match_the_known_values() {
    assert_eq!(count_primes(0, 10), 4);
    assert_eq!(count_primes(0, 100), 25);
    assert_eq!(count_primes(0, 1_000_000), 78_498);
    assert_eq!(count_primes(1 << 20, 1 << 21), 155_611 - 82_025);
    assert_eq!(count_primes(7, 8), 1, "a range of one prime");
    assert_eq!(count_primes(8, 8), 0);
    assert_eq!(count_primes(0, 2), 0, "0 and 1 are not prime");
}

#[test]
fn a_range_split_any_way_counts_the_same_as_the_whole() {
    let job = Job::Primes {
        lo: 999_000,
        hi: 1_999_000,
    };
    let whole = run(&job).unwrap();
    for parts in [1, 2, 3, 7, 64] {
        let chunks = split(&job, parts).unwrap();
        assert_eq!(chunks.len(), parts as usize);
        let results: Vec<JobResult> = chunks.iter().map(|c| run(c).unwrap()).collect();
        assert_eq!(combine(&results), Some(whole.clone()), "{parts} parts");
    }
}

#[test]
fn a_chain_is_sha256_iterated_from_the_seed() {
    assert_eq!(sha_chain(5, 1), sha256(&5u64.to_le_bytes()));
    assert_eq!(
        sha_chain(5, 3),
        sha256(&sha256(&sha256(&5u64.to_le_bytes())))
    );
    let chunks = split(
        &Job::ShaChain {
            seed: u64::MAX,
            n: 2,
        },
        2,
    )
    .unwrap();
    assert_eq!(
        chunks,
        [
            Job::ShaChain {
                seed: u64::MAX,
                n: 2
            },
            Job::ShaChain { seed: 0, n: 2 }
        ]
    );
}

#[test]
fn chain_digests_combine_in_order_and_a_reordering_shows() {
    let a = run(&Job::ShaChain { seed: 1, n: 10 }).unwrap();
    let b = run(&Job::ShaChain { seed: 2, n: 10 }).unwrap();
    assert_ne!(
        combine(&[a.clone(), b.clone()]),
        combine(&[b.clone(), a.clone()])
    );
    assert_eq!(
        combine(&[a, JobResult::Primes { count: 1 }]),
        None,
        "mixed kinds"
    );
    assert_eq!(combine(&[]), None);
}

#[test]
fn jobs_past_their_caps_or_malformed_are_refused_before_any_work() {
    let refused = |job: Job| run(&job).err();
    assert_eq!(
        refused(Job::Primes {
            lo: 0,
            hi: MAX_PRIMES_SPAN + 1
        }),
        Some(JobRefusal::TooLarge)
    );
    assert_eq!(
        refused(Job::Primes { lo: 5, hi: 4 }),
        Some(JobRefusal::Malformed)
    );
    let past = MAX_PRIMES_HI + 1;
    assert_eq!(
        refused(Job::Primes {
            lo: past - 10,
            hi: past
        }),
        Some(JobRefusal::Malformed)
    );
    assert_eq!(
        refused(Job::ShaChain { seed: 0, n: 0 }),
        Some(JobRefusal::Malformed)
    );
    assert_eq!(
        refused(Job::ShaChain {
            seed: 0,
            n: MAX_SHA_CHAIN + 1
        }),
        Some(JobRefusal::TooLarge)
    );
    assert!(
        run(&Job::Primes {
            lo: 0,
            hi: MAX_PRIMES_SPAN
        })
        .is_ok(),
        "the cap itself is allowed"
    );
    let job = Job::ShaChain { seed: 0, n: 1 };
    assert_eq!(split(&job, 0), Err(JobRefusal::Malformed));
    assert_eq!(split(&job, MAX_CHUNKS + 1), Err(JobRefusal::TooLarge));
}

#[test]
fn the_spot_checked_chunk_is_in_range_and_fixed_by_the_job_id() {
    assert_eq!(spot_check(1, 0), None);
    for id in 0..200 {
        let pick = spot_check(id, 7).unwrap();
        assert!(pick < 7);
        assert_eq!(spot_check(id, 7), Some(pick));
    }
    let picks: std::collections::BTreeSet<usize> =
        (0..200).filter_map(|id| spot_check(id, 7)).collect();
    assert_eq!(picks.len(), 7, "every chunk can be the checked one");
}
