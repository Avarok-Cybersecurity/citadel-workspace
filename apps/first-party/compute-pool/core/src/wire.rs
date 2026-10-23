//! What crosses between pool members, pure: the routes a member serves and their CBOR bodies,
//! and the small messages on the `pool` topic. Bulk work rides internal HTTP; the topic only
//! announces, claims and reports.

use crate::jobs::{self, Job, JobRefusal, JobResult};
use alloc::string::String;
use alloc::vec::Vec;
use citadel_app_sdk_types::calls::HttpMethod;
use citadel_app_sdk_types::{decode, encode};
use serde::{Deserialize, Serialize};

/// The pool's one topic.
pub const TOPIC: &str = "pool";
/// The routes, as the manifest lists them (`METHOD /path`).
pub const ROUTES: [(HttpMethod, &str); 4] = [
    (HttpMethod::Post, "/job/primes"),
    (HttpMethod::Post, "/job/sha-chain"),
    (HttpMethod::Post, "/job/chunks"),
    (HttpMethod::Get, "/health"),
];

/// The method as a manifest route names it.
pub fn method_name(m: &HttpMethod) -> &'static str {
    match m {
        HttpMethod::Get => "GET",
        HttpMethod::Post => "POST",
        HttpMethod::Put => "PUT",
        HttpMethod::Delete => "DELETE",
        HttpMethod::Patch => "PATCH",
        HttpMethod::Head => "HEAD",
    }
}

/// Work for one member: every chunk of `job` that `assign` gives `worker`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Assignment {
    pub job_id: u64,
    pub job: Job,
    pub chunks: u32,
    /// `(username, chunk index)`.
    pub assign: Vec<(String, u32)>,
}

/// One member's answers: `(chunk index, result)`.
pub type ChunkResults = Vec<(u32, JobResult)>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PoolMsg {
    Heartbeat { cores: u32, load: u32 },
    Announce { job_id: u64, chunks: u32 },
    Claim { job_id: u64 },
    Done { job_id: u64, digest: [u8; 32] },
}

/// A served answer: the status and the CBOR body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Answer {
    pub status: u16,
    pub body: Vec<u8>,
}

fn refusal(r: JobRefusal) -> Answer {
    let status = match r {
        JobRefusal::Malformed => 400,
        JobRefusal::TooLarge => 413,
    };
    Answer {
        status,
        body: Vec::new(),
    }
}

fn ok<T: Serialize>(value: &T) -> Answer {
    Answer {
        status: 200,
        body: encode(value),
    }
}

fn job_of(body: &[u8], want_primes: bool) -> Result<Job, JobRefusal> {
    let job: Job = decode(body).map_err(|_| JobRefusal::Malformed)?;
    match (&job, want_primes) {
        (Job::Primes { .. }, true) | (Job::ShaChain { .. }, false) => Ok(job),
        _ => Err(JobRefusal::Malformed),
    }
}

/// The chunks `me` was given, computed.
pub fn work(me: &str, a: &Assignment) -> Result<ChunkResults, JobRefusal> {
    let chunks = jobs::split(&a.job, a.chunks)?;
    a.assign
        .iter()
        .filter(|(who, _)| who == me)
        .map(|(_, i)| {
            let chunk = chunks.get(*i as usize).ok_or(JobRefusal::Malformed)?;
            Ok((*i, jobs::run(chunk)?))
        })
        .collect()
}

/// A request to this member, answered. `me` is the serving member's username.
pub fn serve(me: &str, method: HttpMethod, path: &str, body: &[u8]) -> Answer {
    let answer = match (method, path) {
        (HttpMethod::Get, "/health") => Ok(ok(&"ok")),
        (HttpMethod::Post, "/job/primes") => job_of(body, true)
            .and_then(|j| jobs::run(&j))
            .map(|r| ok(&r)),
        (HttpMethod::Post, "/job/sha-chain") => job_of(body, false)
            .and_then(|j| jobs::run(&j))
            .map(|r| ok(&r)),
        (HttpMethod::Post, "/job/chunks") => decode::<Assignment>(body)
            .map_err(|_| JobRefusal::Malformed)
            .and_then(|a| work(me, &a))
            .map(|r| ok(&r)),
        _ => {
            return Answer {
                status: 404,
                body: Vec::new(),
            }
        }
    };
    answer.unwrap_or_else(refusal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_route_answers_its_job_and_refuses_the_other_kind() {
        let primes = encode(&Job::Primes { lo: 0, hi: 100 });
        let answer = serve("bob", HttpMethod::Post, "/job/primes", &primes);
        assert_eq!(answer.status, 200);
        assert_eq!(
            decode::<JobResult>(&answer.body),
            Ok(JobResult::Primes { count: 25 })
        );
        assert_eq!(
            serve("bob", HttpMethod::Post, "/job/sha-chain", &primes).status,
            400
        );
        assert_eq!(
            serve("bob", HttpMethod::Post, "/job/primes", b"junk").status,
            400
        );
        let wide = encode(&Job::Primes {
            lo: 0,
            hi: u64::from(u32::MAX),
        });
        assert_eq!(
            serve("bob", HttpMethod::Post, "/job/primes", &wide).status,
            413
        );
        assert_eq!(serve("bob", HttpMethod::Get, "/health", &[]).status, 200);
        assert_eq!(serve("bob", HttpMethod::Delete, "/health", &[]).status, 404);
    }

    #[test]
    fn a_member_computes_only_the_chunks_assigned_to_it() {
        let a = Assignment {
            job_id: 9,
            job: Job::Primes { lo: 0, hi: 100 },
            chunks: 4,
            assign: alloc::vec![("bob".into(), 1), ("carol".into(), 2), ("bob".into(), 3)],
        };
        let answer = serve("bob", HttpMethod::Post, "/job/chunks", &encode(&a));
        let got: ChunkResults = decode(&answer.body).unwrap();
        assert_eq!(got.iter().map(|r| r.0).collect::<Vec<_>>(), [1, 3]);
        assert_eq!(
            got[0].1,
            jobs::run(&Job::Primes { lo: 25, hi: 50 }).unwrap()
        );
        let mut bad = a.clone();
        bad.assign.push(("bob".into(), 9));
        assert_eq!(
            serve("bob", HttpMethod::Post, "/job/chunks", &encode(&bad)).status,
            400
        );
        assert!(
            work("dave", &a).unwrap().is_empty(),
            "nothing assigned, nothing done"
        );
    }

    #[test]
    fn every_topic_message_fits_the_manifests_message_cap() {
        let largest = PoolMsg::Done {
            job_id: u64::MAX,
            digest: [0xff; 32],
        };
        assert!(encode(&largest).len() <= crate::limits::TOPIC_MAX_MSG_BYTES as usize);
        assert_eq!(decode::<PoolMsg>(&encode(&largest)), Ok(largest));
    }
}
