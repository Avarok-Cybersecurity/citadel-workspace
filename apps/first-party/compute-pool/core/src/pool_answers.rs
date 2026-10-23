//! The second half of a job: each worker's answer, then checking and combining them.

use super::{Action, Pool, Record};
use crate::jobs;
use crate::limits::HISTORY_LEN;
use crate::wire::{ChunkResults, PoolMsg};
use alloc::string::String;
use alloc::vec::Vec;
use citadel_app_sdk_types::calls::Via;

fn via_name(via: Via) -> &'static str {
    match via {
        Via::P2p => "p2p",
        Via::Relay => "relay",
        Via::Group => "group",
    }
}

impl Pool {
    /// One worker's answer (or why it has none), over `via`.
    pub fn answered(
        &mut self,
        who: &str,
        answer: Result<ChunkResults, String>,
        via: Via,
    ) -> Vec<Action> {
        let now = self.now_ms;
        let Some(r) = self.running.as_mut() else {
            return Vec::new();
        };
        let rtt = now.saturating_sub(r.dispatched_ms).min(u64::from(u32::MAX)) as u32;
        let note = match answer {
            Ok(results) => {
                let n = results.len();
                for (i, result) in results {
                    r.answers.insert(i, (who.into(), result));
                }
                alloc::format!("{n} chunk(s)")
            }
            Err(why) => why,
        };
        if who == self.me {
            return Vec::new();
        }
        self.latencies.push_back(rtt);
        if self.latencies.len() > 32 {
            self.latencies.pop_front();
        }
        let line = alloc::format!("answer from {who} via {}: {note}", via_name(via));
        let peer = self.peer(who);
        (peer.via, peer.rtt_ms, peer.last) = (Some(via), Some(rtt), Some(note));
        alloc::vec![Action::Log(line)]
    }

    /// Every worker has answered (the fan-out's `done`): fill what is missing locally, check one
    /// chunk, combine, record and report.
    pub fn finish(&mut self) -> Vec<Action> {
        let Some(mut r) = self.running.take() else {
            return Vec::new();
        };
        let Ok(chunks) = jobs::split(&r.assignment.job, r.assignment.chunks) else {
            return Vec::new();
        };
        let check = jobs::spot_check(r.assignment.job_id, chunks.len());
        let mut verified = true;
        let mut results = Vec::with_capacity(chunks.len());
        for (i, chunk) in chunks.iter().enumerate() {
            let own = || jobs::run(chunk).ok();
            let theirs = r.answers.remove(&(i as u32));
            let result = match (theirs, check == Some(i)) {
                (Some((who, got)), true) => {
                    let mine = own();
                    if mine.as_ref() != Some(&got) {
                        verified = false;
                        self.peer(&who).last = Some("wrong answer".into());
                    }
                    mine
                }
                (Some((_, got)), false) => Some(got),
                (None, _) => own(),
            };
            let Some(result) = result else {
                return Vec::new();
            };
            results.push(result);
        }
        let Some(result) = jobs::combine(&results) else {
            return Vec::new();
        };
        let ms = self
            .now_ms
            .saturating_sub(r.started_ms)
            .min(u64::from(u32::MAX)) as u32;
        let record = Record {
            job_id: r.assignment.job_id,
            job: r.assignment.job,
            result,
            verified,
            ms,
        };
        self.history.push_back(record.clone());
        while self.history.len() > HISTORY_LEN {
            self.history.pop_front();
        }
        let digest = crate::sha256::sha256(&citadel_app_sdk_types::encode(&record.result));
        let outcome = if verified { "verified" } else { "wrong answer" };
        let line = alloc::format!("job {:x} done in {ms} ms: {outcome}", record.job_id);
        alloc::vec![
            Action::Log(line),
            Action::Publish(PoolMsg::Done {
                job_id: record.job_id,
                digest
            }),
            Action::Save(record),
        ]
    }
}
