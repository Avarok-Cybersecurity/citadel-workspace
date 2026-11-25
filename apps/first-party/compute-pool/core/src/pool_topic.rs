//! This member's place in the pool's topic. The host answers a topic open only once the member
//! hears the group (the page's topic port waits for the agent to admit it), so `joined` is the
//! moment the member can say it is there. A failed open is said and shown; the app never retries on
//! a timer: the host does a bounded number of tries and then waits, showing who it waits for
//! (runtime/topic-rejoin.ts), and tells the app with a `members` event once the member is in.

use super::{Action, Pool};
use crate::limits::HEARTBEAT_MS;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Membership {
    /// The topic is being opened.
    Joining,
    /// In the topic: heartbeats go out and announcements are heard.
    In,
    /// The open failed with `why`; the host says when the member is in.
    Out { why: String },
}

impl Pool {
    /// The topic opened: the next tick announces this member, whatever the interval says.
    pub fn joined(&mut self) {
        self.membership = Membership::In;
        self.since_heartbeat = HEARTBEAT_MS;
    }

    /// The topic did not open: say why.
    pub fn join_failed(&mut self, why: &str) -> Vec<Action> {
        self.membership = Membership::Out {
            why: why.to_string(),
        };
        alloc::vec![Action::Log(alloc::format!(
            "not in the pool: {why}; joining when the host admits this member"
        ))]
    }

    /// The host says who is on the topic: a member out of it is in now, so open it again (the
    /// host answers at once). Once per such event, never on a timer.
    pub fn heard_members(&mut self) -> Vec<Action> {
        if !matches!(self.membership, Membership::Out { .. }) {
            return Vec::new();
        }
        self.membership = Membership::Joining;
        alloc::vec![Action::JoinTopic]
    }
}

#[cfg(test)]
#[path = "pool_topic_tests.rs"]
mod tests;
