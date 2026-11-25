//! This member's place in the pool's topic. The host answers a topic open only once the member
//! hears the group (the page's topic port waits for the agent to admit it), so `joined` is the
//! moment the member can say it is there; a failed open is said, shown and tried again.

use super::{Action, Pool};
use crate::limits::{HEARTBEAT_MS, JOIN_RETRY_MS};
use alloc::string::{String, ToString};
use alloc::vec::Vec;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Membership {
    /// The topic is being opened.
    Joining,
    /// In the topic: heartbeats go out and announcements are heard.
    In,
    /// The open failed with `why`; the next try is `retry_in_ms` away.
    Out { why: String, retry_in_ms: u32 },
}

impl Pool {
    /// The topic opened: the next tick announces this member, whatever the interval says.
    pub fn joined(&mut self) {
        self.membership = Membership::In;
        self.since_heartbeat = HEARTBEAT_MS;
    }

    /// The topic did not open: say why, and try again after `JOIN_RETRY_MS`.
    pub fn join_failed(&mut self, why: &str) -> Vec<Action> {
        self.membership = Membership::Out {
            why: why.to_string(),
            retry_in_ms: JOIN_RETRY_MS,
        };
        let secs = JOIN_RETRY_MS / 1000;
        alloc::vec![Action::Log(alloc::format!(
            "not in the pool: {why}; trying again in {secs} s"
        ))]
    }

    /// The retry, when it is due.
    pub(super) fn retry_join(&mut self, dt_ms: u32) -> Option<Action> {
        let Membership::Out { retry_in_ms, .. } = &mut self.membership else {
            return None;
        };
        *retry_in_ms = retry_in_ms.saturating_sub(dt_ms);
        if *retry_in_ms > 0 {
            return None;
        }
        self.membership = Membership::Joining;
        Some(Action::JoinTopic)
    }
}

#[cfg(test)]
#[path = "pool_topic_tests.rs"]
mod tests;
