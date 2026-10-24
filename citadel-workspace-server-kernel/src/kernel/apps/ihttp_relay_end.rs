//! How relayed state ends (R4.4): with both ends' `End` or a `Cancel`, at its deadline, with
//! its session, with the instance that withdraws, or with its install or a member's access to
//! it. A withdrawal, an uninstall, a disable and a suspension, which the kernel answers for,
//! name the surviving end of every stream they closed, so it can be sent `Cancel { Closed }` at
//! once instead of waiting out the stream's deadline. A deadline closes the stream at the next
//! relay request after it passes, and is recorded so the kernel sends both ends
//! `Cancel { Timeout }`. A session's end runs in a destructor that cannot reach the sessions;
//! the surviving ends time out. Every close is recorded (`take_records`) for the audit line.

use super::ihttp_adverts::Withdrawal;
use super::ihttp_relay::{IhttpRelay, RelayStream};
use super::ihttp_relay_types::{CloseReason, Endpoint, Forward, RelayRecord};

impl IhttpRelay {
    /// The session `cid` ended: whatever it advertised, and every stream it was an end of.
    /// Answers how many streams that closed.
    pub fn forget_session(&mut self, cid: u64) -> usize {
        self.adverts.forget_session(cid);
        self.last_client_stream
            .retain(|(caller, _), _| *caller != cid);
        let picked = |s: &RelayStream| s.client.cid == cid || s.server.cid == cid;
        let ended = self.end(picked, |_| true, CloseReason::Session, None);
        ended.closed
    }

    /// `instance` of session `cid` stopped serving `install_id`. Once no other instance of the
    /// session advertises it, the streams the session serves for it end; answers the callers to
    /// tell, and how many streams closed.
    pub fn withdraw(&mut self, install_id: &str, cid: u64, instance: &str, now_ms: u64) -> Ended {
        if self.adverts.withdraw(install_id, cid, instance) == Withdrawal::StillServed {
            return Ended::default();
        }
        let ours = |e: &Endpoint| e.cid == cid && e.install_id == install_id;
        self.end(|s| ours(&s.server), ours, CloseReason::Closed, Some(now_ms))
    }

    /// The install is gone: its advertisements, and every stream either end of which it was.
    pub fn forget_install(&mut self, install_id: &str, now_ms: u64) -> Ended {
        self.adverts.forget_install(install_id);
        self.last_client_stream
            .retain(|(_, install), _| install != install_id);
        let its = |e: &Endpoint| e.install_id == install_id;
        let picked = |s: &RelayStream| its(&s.client) || its(&s.server);
        self.end(picked, its, CloseReason::Closed, Some(now_ms))
    }

    /// `username` may no longer use `install_id` (they disabled it for themselves, or it was
    /// suspended): every stream on which one of their sessions is an end of it. The other end of
    /// each is told; the member's own end is closed by their page.
    pub fn forget_member(&mut self, install_id: &str, username: &str, now_ms: u64) -> Ended {
        let theirs = |e: &Endpoint| e.install_id == install_id && e.username == username;
        let picked = |s: &RelayStream| theirs(&s.client) || theirs(&s.server);
        self.end(picked, theirs, CloseReason::Closed, Some(now_ms))
    }

    /// Close every stream whose deadline has passed, recorded as `Timeout`.
    pub fn expire(&mut self, now_ms: u64) {
        self.adverts.expire(now_ms);
        let over: Vec<u64> = self
            .streams
            .iter()
            .filter(|(_, s)| s.deadline_ms <= now_ms)
            .map(|(id, _)| *id)
            .collect();
        over.into_iter()
            .for_each(|id| self.close(id, CloseReason::Timeout, now_ms));
    }

    /// Streams opened and closed since this was last asked, oldest first.
    pub fn take_records(&mut self) -> Vec<RelayRecord> {
        std::mem::take(&mut self.records)
    }

    pub(super) fn record(
        &mut self,
        id: u64,
        s: &RelayStream,
        closed: Option<CloseReason>,
        now_ms: u64,
    ) {
        self.records.push(RelayRecord {
            closed,
            client: s.client.clone(),
            client_stream: s.client_stream,
            server: s.server.clone(),
            stream: id,
            bytes: s.flow.body_bytes(),
            ms: now_ms.saturating_sub(s.opened_ms),
        });
    }

    pub(super) fn close(&mut self, id: u64, reason: CloseReason, now_ms: u64) {
        if let Some(stream) = self.streams.remove(&id) {
            self.record(id, &stream, Some(reason), now_ms);
            let key = (
                stream.client.cid,
                stream.client.install_id,
                stream.client_stream,
            );
            self.by_client.remove(&key);
        }
    }

    /// Closes the streams `picked` names as `reason`; tells each end that `gone` does not cover.
    /// Without `now_ms` (a session's end, in a destructor with no clock) each record's `ms` is 0.
    fn end(
        &mut self,
        picked: impl Fn(&RelayStream) -> bool,
        gone: impl Fn(&Endpoint) -> bool,
        reason: CloseReason,
        now_ms: Option<u64>,
    ) -> Ended {
        let ids: Vec<u64> = self
            .streams
            .iter()
            .filter(|(_, s)| picked(s))
            .map(|(id, _)| *id)
            .collect();
        let mut ended = Ended::default();
        for id in ids {
            let Some(s) = self.streams.get(&id).cloned() else {
                continue;
            };
            if !gone(&s.client) {
                ended.tell.push(Forward {
                    from: s.server.clone(),
                    to: s.client.clone(),
                    stream: s.client_stream,
                });
            }
            if !gone(&s.server) {
                ended.tell.push(Forward {
                    from: s.client,
                    to: s.server,
                    stream: id,
                });
            }
            self.close(id, reason, now_ms.unwrap_or(s.opened_ms));
            ended.closed += 1;
        }
        ended
    }
}

/// What an end closed: how many streams, and the surviving ends to send `Cancel { Closed }`, on
/// the id each knows its stream by.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Ended {
    pub closed: usize,
    pub tell: Vec<Forward>,
}
