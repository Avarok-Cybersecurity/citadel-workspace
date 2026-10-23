//! The pool as one member sees it, pure: who is there (from heartbeats), the job this member
//! runs (announce, collect claims, hand chunks out, check one, combine), and the history. Every
//! input is a message, an answer or elapsed time; every output is an [`Action`] the app performs.

use crate::jobs::{self, Job, JobResult};
use crate::limits::*;
use crate::wire::{work, Assignment, PoolMsg};
use alloc::collections::{BTreeMap, BTreeSet, VecDeque};
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use citadel_app_sdk_types::calls::{Transport, Via};
use serde::{Deserialize, Serialize};

/// The chunks a job is split into.
pub const CHUNKS: u32 = 8;

/// Which transport the dashboard's toggle forces.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Prefer,
    P2p,
    Relay,
}

impl Mode {
    pub fn transport(self) -> Transport {
        match self {
            Mode::Prefer => Transport::PreferP2pThenRelay,
            Mode::P2p => Transport::P2p,
            Mode::Relay => Transport::Relay,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Peer {
    pub last_seen_ms: u64,
    pub cores: u32,
    pub load: u32,
    pub via: Option<Via>,
    pub rtt_ms: Option<u32>,
    pub last: Option<String>,
}

/// One finished job, as `storage.user` keeps it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    pub job_id: u64,
    pub job: Job,
    pub result: JobResult,
    /// The spot-checked chunk agreed with this member's own computation.
    pub verified: bool,
    pub ms: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    Publish(PoolMsg),
    /// Call each target once with the assignment, on the mode's transport.
    Fanout {
        targets: Vec<String>,
        assignment: Assignment,
    },
    Save(Record),
    /// A line for the app's log (`log.write`, info).
    Log(String),
}

struct Running {
    assignment: Assignment,
    claimants: BTreeSet<String>,
    claim_left_ms: Option<u32>,
    started_ms: u64,
    dispatched_ms: u64,
    answers: BTreeMap<u32, (String, JobResult)>,
}

pub struct Pool {
    pub me: String,
    pub mode: Mode,
    pub cores: u32,
    pub now_ms: u64,
    pub peers: BTreeMap<String, Peer>,
    pub history: VecDeque<Record>,
    /// The most recent answer latencies, oldest first.
    pub latencies: VecDeque<u32>,
    running: Option<Running>,
    seq: u32,
    since_heartbeat: u32,
}

impl Pool {
    pub fn new(me: &str, cores: u32) -> Pool {
        Pool {
            me: me.to_string(),
            mode: Mode::Prefer,
            cores,
            now_ms: 0,
            peers: BTreeMap::new(),
            history: VecDeque::new(),
            latencies: VecDeque::new(),
            running: None,
            seq: 0,
            // The first tick announces this member.
            since_heartbeat: HEARTBEAT_MS,
        }
    }

    /// `(chunks answered, chunks)` of the job in flight.
    pub fn progress(&self) -> Option<(usize, u32)> {
        self.running
            .as_ref()
            .map(|r| (r.answers.len(), r.assignment.chunks))
    }

    fn peer(&mut self, who: &str) -> &mut Peer {
        let now = self.now_ms;
        self.peers.entry(who.to_string()).or_insert(Peer {
            last_seen_ms: now,
            cores: 0,
            load: 0,
            via: None,
            rtt_ms: None,
            last: None,
        })
    }

    pub fn tick(&mut self, dt_ms: u32) -> Vec<Action> {
        self.now_ms += u64::from(dt_ms);
        let now = self.now_ms;
        self.peers
            .retain(|_, p| now.saturating_sub(p.last_seen_ms) <= PEER_STALE_MS);
        let mut out = Vec::new();
        self.since_heartbeat = self.since_heartbeat.saturating_add(dt_ms);
        if self.since_heartbeat >= HEARTBEAT_MS {
            self.since_heartbeat = 0;
            let load = u32::from(self.running.is_some());
            out.push(Action::Publish(PoolMsg::Heartbeat {
                cores: self.cores,
                load,
            }));
        }
        let due = self.running.as_mut().and_then(|r| {
            let left = r.claim_left_ms.as_mut()?;
            *left = left.saturating_sub(dt_ms);
            (*left == 0).then_some(())
        });
        if due.is_some() {
            out.extend(self.dispatch());
        }
        out
    }

    /// Start `job`: announce it and collect claims. `None` while a job is in flight or when the
    /// job is refused.
    pub fn run(&mut self, job: Job) -> Option<Vec<Action>> {
        if self.running.is_some() || jobs::check(&job).is_err() {
            return None;
        }
        self.seq += 1;
        // Unique across members: this member's name, digested, then its own sequence.
        let tag = crate::sha256::sha256(self.me.as_bytes());
        let job_id = (u64::from(u32::from_be_bytes([tag[0], tag[1], tag[2], tag[3]])) << 32)
            | u64::from(self.seq);
        let assignment = Assignment {
            job_id,
            job,
            chunks: CHUNKS,
            assign: Vec::new(),
        };
        self.running = Some(Running {
            assignment,
            claimants: BTreeSet::new(),
            claim_left_ms: Some(CLAIM_WINDOW_MS),
            started_ms: self.now_ms,
            dispatched_ms: self.now_ms,
            answers: BTreeMap::new(),
        });
        Some(alloc::vec![Action::Publish(PoolMsg::Announce {
            job_id,
            chunks: CHUNKS
        })])
    }

    /// Hand the chunks out round-robin to the claimants; with none, this member does them all.
    fn dispatch(&mut self) -> Vec<Action> {
        let (me, now) = (self.me.clone(), self.now_ms);
        let Some(r) = self.running.as_mut() else {
            return Vec::new();
        };
        (r.claim_left_ms, r.dispatched_ms) = (None, now);
        let workers: Vec<String> = r.claimants.iter().cloned().collect();
        let pick = |i: u32| workers.get(i as usize % workers.len().max(1)).cloned();
        r.assignment.assign = (0..r.assignment.chunks)
            .map(|i| (pick(i).unwrap_or_else(|| me.clone()), i))
            .collect();
        if workers.is_empty() {
            let mine = work(&me, &r.assignment).unwrap_or_default();
            let mut out = self.answered(&me, Ok(mine), Via::Relay);
            out.extend(self.finish());
            return out;
        }
        let assignment = r.assignment.clone();
        alloc::vec![Action::Fanout {
            targets: workers,
            assignment
        }]
    }

    pub fn on_msg(&mut self, from: &str, msg: PoolMsg) -> Vec<Action> {
        if from == self.me {
            return Vec::new();
        }
        let now = self.now_ms;
        let peer = self.peer(from);
        peer.last_seen_ms = now;
        match msg {
            PoolMsg::Heartbeat { cores, load } => (peer.cores, peer.load) = (cores, load),
            PoolMsg::Announce { job_id, .. } => {
                return alloc::vec![Action::Publish(PoolMsg::Claim { job_id })];
            }
            PoolMsg::Claim { job_id } => {
                if let Some(r) = self.running.as_mut() {
                    if r.assignment.job_id == job_id && r.claim_left_ms.is_some() {
                        r.claimants.insert(from.to_string());
                    }
                }
            }
            PoolMsg::Done { job_id, .. } => peer.last = Some(alloc::format!("finished {job_id:x}")),
        }
        Vec::new()
    }
}

#[path = "pool_answers.rs"]
mod answers;

#[cfg(test)]
#[path = "pool_tests.rs"]
mod tests;
