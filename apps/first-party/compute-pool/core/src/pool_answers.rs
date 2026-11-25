//! The second half of a job: each worker's answer, then checking and combining them.

use super::{Action, Pool, Record};
use crate::jobs;
use crate::limits::HISTORY_LEN;
use crate::record::Check;
use crate::wire::{ChunkResults, PoolMsg};
use alloc::collections::BTreeSet;
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
    /// member's chunk, combine, record and report. With no member's chunk, the job was computed
    /// here alone, and the record says so (record.rs).
    pub fn finish(&mut self) -> Vec<Action> {
        let Some(mut r) = self.running.take() else {
            return Vec::new();
        };
        let Ok(chunks) = jobs::split(&r.assignment.job, r.assignment.chunks) else {
            return Vec::new();
        };
        // The checked chunk is one a member answered: one computed here would check nothing.
        let theirs: Vec<(usize, &String)> = (r.answers.iter())
            .filter(|(i, (who, _))| *who != self.me && (**i as usize) < chunks.len())
            .map(|(i, (who, _))| (*i as usize, who))
            .collect();
        let check = jobs::spot_check(r.assignment.job_id, theirs.len()).map(|k| theirs[k].0);
        let helpers: BTreeSet<String> = theirs.iter().map(|(_, who)| (*who).clone()).collect();
        let helpers: Vec<String> = helpers.into_iter().collect();
        let mut found = Check::NothingTheirs;
        let mut results = Vec::with_capacity(chunks.len());
        for (i, chunk) in chunks.iter().enumerate() {
            let own = || jobs::run(chunk).ok();
            let theirs = r.answers.remove(&(i as u32));
            let result = match (theirs, check == Some(i)) {
                (Some((who, got)), true) => {
                    let mine = own();
                    let agreed = mine.as_ref() == Some(&got);
                    if !agreed {
                        self.peer(&who).last = Some("wrong answer".into());
                    }
                    found = if agreed {
                        Check::Agreed
                    } else {
                        Check::Disagreed
                    };
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
            helpers,
            check: Some(found),
            ms,
        };
        self.history.push_back(record.clone());
        while self.history.len() > HISTORY_LEN {
            self.history.pop_front();
        }
        let digest = crate::sha256::sha256(&citadel_app_sdk_types::encode(&record.result));
        let line = alloc::format!(
            "job {:x} done in {ms} ms: {}",
            record.job_id,
            record.outcome().wording()
        );
        let done = self.publish(PoolMsg::Done {
            job_id: record.job_id,
            digest,
        });
        alloc::vec![Action::Log(line), done, Action::Save(record)]
    }
}
