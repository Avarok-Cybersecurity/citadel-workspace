//! Polls (Calendar design §3.6.3): a host proposes slots, members vote, and the host picks one,
//! which turns the poll into an event. The poll is the host's (`cal/poll/<id>` in their authored
//! namespace on the node); each vote is its voter's (`cal/poll-vote/<id>` in theirs), so no one
//! can vote for another and the tally is read, never kept.

use crate::model::Username;
use crate::slots::Interval;
use crate::tz::Zone;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// The most slots one poll proposes.
pub const MAX_PROPOSALS: usize = 20;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Poll {
    pub id: String,
    pub type_id: String,
    pub host: Username,
    pub title: String,
    /// The zone the host proposed in.
    pub zone: Zone,
    /// In time order, none overlapping.
    pub proposals: Vec<Interval>,
    pub state: PollState,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum PollState {
    Open,
    /// The host chose `proposal`; `event_id` is the event it became.
    Picked {
        proposal: u16,
        event_id: String,
    },
    Closed,
}

/// One member's vote: the proposals they can make, and those they could if they must.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct PollVote {
    pub poll_id: String,
    pub yes: Vec<u16>,
    pub maybe: Vec<u16>,
}

/// Who can make one proposal.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct ProposalTally {
    pub proposal: u16,
    pub yes: Vec<Username>,
    pub maybe: Vec<Username>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PollError {
    /// The poll proposes nothing, too much, or slots out of order, empty or overlapping.
    BadProposals,
    /// The vote names a proposal the poll does not have, or one twice.
    BadVote,
    /// The poll no longer takes votes or a pick.
    NotOpen,
}

pub fn check_poll(poll: &Poll) -> Result<(), PollError> {
    let p = &poll.proposals;
    let shaped =
        !p.is_empty() && p.len() <= MAX_PROPOSALS && p.iter().all(|i| i.end_ms > i.start_ms);
    if !shaped || p.windows(2).any(|w| w[1].start_ms < w[0].end_ms) {
        return Err(PollError::BadProposals);
    }
    Ok(())
}

/// Whether `vote` may be cast on `poll`: open, and each proposal named at most once overall.
pub fn check_vote(poll: &Poll, vote: &PollVote) -> Result<(), PollError> {
    if poll.state != PollState::Open {
        return Err(PollError::NotOpen);
    }
    let named: Vec<u16> = vote.yes.iter().chain(&vote.maybe).copied().collect();
    let in_range = named.iter().all(|i| usize::from(*i) < poll.proposals.len());
    let once = named
        .iter()
        .enumerate()
        .all(|(n, i)| !named[..n].contains(i));
    if vote.poll_id != poll.id || !in_range || !once {
        return Err(PollError::BadVote);
    }
    Ok(())
}

/// Each proposal with who said yes and maybe, in proposal order. A vote that does not pass
/// `check_vote` (cast on another poll, or naming a proposal since removed) counts for nothing.
pub fn tally(poll: &Poll, votes: &[(Username, PollVote)]) -> Vec<ProposalTally> {
    let open = Poll {
        state: PollState::Open,
        ..poll.clone()
    };
    let counted: Vec<&(Username, PollVote)> = votes
        .iter()
        .filter(|(_, v)| check_vote(&open, v).is_ok())
        .collect();
    (0..poll.proposals.len() as u16)
        .map(|proposal| {
            let who = |pick: fn(&PollVote) -> &Vec<u16>| {
                let mut names: Vec<Username> = counted
                    .iter()
                    .filter(|(_, v)| pick(v).contains(&proposal))
                    .map(|(name, _)| name.clone())
                    .collect();
                names.sort();
                names.dedup();
                names
            };
            ProposalTally {
                proposal,
                yes: who(|v| &v.yes),
                maybe: who(|v| &v.maybe),
            }
        })
        .collect()
}

/// The proposal most can make: most yes, then most maybe, then the earliest. None for no votes.
pub fn leading(tallies: &[ProposalTally]) -> Option<u16> {
    tallies
        .iter()
        .filter(|t| !t.yes.is_empty() || !t.maybe.is_empty())
        .max_by_key(|t| (t.yes.len(), t.maybe.len(), core::cmp::Reverse(t.proposal)))
        .map(|t| t.proposal)
}

/// The poll once the host picks `proposal` as `event_id`; only an open poll's own proposal.
pub fn pick(poll: &Poll, proposal: u16, event_id: String) -> Result<(Poll, Interval), PollError> {
    if poll.state != PollState::Open {
        return Err(PollError::NotOpen);
    }
    let slot = *poll
        .proposals
        .get(usize::from(proposal))
        .ok_or(PollError::BadVote)?;
    let picked = Poll {
        state: PollState::Picked { proposal, event_id },
        ..poll.clone()
    };
    Ok((picked, slot))
}
