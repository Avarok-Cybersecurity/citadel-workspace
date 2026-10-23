//! The deterministic jobs a pool member serves, pure: count the primes in a range, run a SHA-256
//! chain. Every answer is a function of the request alone, so a requester can recompute any
//! chunk and catch a wrong one.

use crate::sha256::sha256;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// The widest range one primes job may cover.
pub const MAX_PRIMES_SPAN: u64 = 2_000_000;
/// The highest number a primes job may reach (the sieve's square root stays small).
pub const MAX_PRIMES_HI: u64 = 1 << 40;
/// The longest SHA-256 chain one job may run.
pub const MAX_SHA_CHAIN: u32 = 100_000;
/// The most chunks a job is split into.
pub const MAX_CHUNKS: u32 = 64;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Job {
    /// The primes `p` with `lo <= p < hi`.
    Primes { lo: u64, hi: u64 },
    /// `n` rounds of SHA-256, from the digest of `seed`'s little-endian bytes.
    ShaChain { seed: u64, n: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobResult {
    Primes { count: u64 },
    ShaChain { digest: [u8; 32] },
}

/// Why a job was not run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobRefusal {
    /// `lo > hi`, `hi` past `MAX_PRIMES_HI`, `n == 0`, or no chunks.
    Malformed,
    /// Wider than `MAX_PRIMES_SPAN`, longer than `MAX_SHA_CHAIN`, or more than `MAX_CHUNKS`.
    TooLarge,
}

/// The primes below `limit`, by the sieve of Eratosthenes.
fn small_primes(limit: u64) -> Vec<u64> {
    let mut composite = alloc::vec![false; limit as usize];
    let mut primes = Vec::new();
    for i in 2..limit {
        if !composite[i as usize] {
            primes.push(i);
            let mut j = i * i;
            while j < limit {
                composite[j as usize] = true;
                j += i;
            }
        }
    }
    primes
}

/// How many primes lie in `[lo, hi)`: a segmented sieve over the segment.
pub fn count_primes(lo: u64, hi: u64) -> u64 {
    let lo = lo.max(2);
    if hi <= lo {
        return 0;
    }
    let mut composite = alloc::vec![false; (hi - lo) as usize];
    for p in small_primes((hi - 1).isqrt() + 1) {
        let first = (p * p).max(lo.div_ceil(p) * p);
        let mut m = first;
        while m < hi {
            composite[(m - lo) as usize] = true;
            m += p;
        }
    }
    composite.iter().filter(|c| !**c).count() as u64
}

/// `n` rounds of SHA-256 from the digest of `seed`.
pub fn sha_chain(seed: u64, n: u32) -> [u8; 32] {
    let mut digest = sha256(&seed.to_le_bytes());
    for _ in 1..n {
        digest = sha256(&digest);
    }
    digest
}

pub fn check(job: &Job) -> Result<(), JobRefusal> {
    match *job {
        Job::Primes { lo, hi } if lo > hi || hi > MAX_PRIMES_HI => Err(JobRefusal::Malformed),
        Job::Primes { lo, hi } if hi - lo > MAX_PRIMES_SPAN => Err(JobRefusal::TooLarge),
        Job::ShaChain { n: 0, .. } => Err(JobRefusal::Malformed),
        Job::ShaChain { n, .. } if n > MAX_SHA_CHAIN => Err(JobRefusal::TooLarge),
        _ => Ok(()),
    }
}

pub fn run(job: &Job) -> Result<JobResult, JobRefusal> {
    check(job)?;
    Ok(match *job {
        Job::Primes { lo, hi } => JobResult::Primes {
            count: count_primes(lo, hi),
        },
        Job::ShaChain { seed, n } => JobResult::ShaChain {
            digest: sha_chain(seed, n),
        },
    })
}

/// `job` as `parts` chunks: a range in near-equal sub-ranges, a chain as `parts` chains seeded
/// `seed`, `seed + 1`, ... (a chain cannot be split; its parts are independent work).
pub fn split(job: &Job, parts: u32) -> Result<Vec<Job>, JobRefusal> {
    if parts == 0 {
        return Err(JobRefusal::Malformed);
    }
    if parts > MAX_CHUNKS {
        return Err(JobRefusal::TooLarge);
    }
    Ok(match *job {
        Job::Primes { lo, hi } => {
            let span = hi.saturating_sub(lo);
            let p = u64::from(parts);
            let edge = |i: u64| lo + span * i / p;
            (0..p)
                .map(|i| Job::Primes {
                    lo: edge(i),
                    hi: edge(i + 1),
                })
                .collect()
        }
        Job::ShaChain { seed, n } => (0..u64::from(parts))
            .map(|i| Job::ShaChain {
                seed: seed.wrapping_add(i),
                n,
            })
            .collect(),
    })
}

/// The whole job's answer from its chunks' answers, in chunk order: the prime counts summed,
/// or the digest of the chains' digests. `None` when the answers are not all of one kind.
pub fn combine(results: &[JobResult]) -> Option<JobResult> {
    match results.first()? {
        JobResult::Primes { .. } => results
            .iter()
            .map(|r| match r {
                JobResult::Primes { count } => Some(*count),
                JobResult::ShaChain { .. } => None,
            })
            .sum::<Option<u64>>()
            .map(|count| JobResult::Primes { count }),
        JobResult::ShaChain { .. } => {
            let mut all = Vec::with_capacity(results.len() * 32);
            for r in results {
                let JobResult::ShaChain { digest } = r else {
                    return None;
                };
                all.extend_from_slice(digest);
            }
            Some(JobResult::ShaChain {
                digest: sha256(&all),
            })
        }
    }
}

/// The chunk the requester recomputes itself: picked from the job's id by its digest, so no
/// worker can know in advance which one is checked.
pub fn spot_check(job_id: u64, chunks: usize) -> Option<usize> {
    let d = sha256(&job_id.to_be_bytes());
    let pick = u64::from_be_bytes([d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]]);
    (chunks > 0).then(|| (pick % chunks as u64) as usize)
}

#[cfg(test)]
#[path = "jobs_tests.rs"]
mod tests;
