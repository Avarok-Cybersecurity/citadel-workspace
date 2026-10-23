//! How relayed state ends (R4.4): with its session, with the instance that withdraws, or with
//! its install. A withdrawal and an uninstall, which the kernel answers for, name the surviving
//! end of every stream they closed, so it can be sent `Cancel { Closed }` at once instead of
//! waiting out the stream's deadline. A session's end runs in a destructor that cannot reach
//! the sessions, and closes silently; the surviving ends time out.

use super::ihttp_adverts::Withdrawal;
use super::ihttp_relay::{IhttpRelay, RelayStream};
use super::ihttp_relay_types::{Endpoint, Forward};

impl IhttpRelay {
    /// The session `cid` ended: whatever it advertised, and every stream it was an end of.
    /// Answers how many streams that closed.
    pub fn forget_session(&mut self, cid: u64) -> usize {
        self.adverts.forget_session(cid);
        let ended = self.end(|s| s.client.cid == cid || s.server.cid == cid, |_| true);
        ended.closed
    }

    /// `instance` of session `cid` stopped serving `install_id`. Once no other instance of the
    /// session advertises it, the streams the session serves for it end; answers the callers to
    /// tell, and how many streams closed.
    pub fn withdraw(&mut self, install_id: &str, cid: u64, instance: &str) -> Ended {
        if self.adverts.withdraw(install_id, cid, instance) == Withdrawal::StillServed {
            return Ended::default();
        }
        let ours = |e: &Endpoint| e.cid == cid && e.install_id == install_id;
        self.end(|s| ours(&s.server), ours)
    }

    /// The install is gone: its advertisements, and every stream either end of which it was.
    pub fn forget_install(&mut self, install_id: &str) -> Ended {
        self.adverts.forget_install(install_id);
        let its = |e: &Endpoint| e.install_id == install_id;
        self.end(|s| its(&s.client) || its(&s.server), its)
    }

    /// Closes the streams `picked` names; tells each end that `gone` does not cover.
    fn end(
        &mut self,
        picked: impl Fn(&RelayStream) -> bool,
        gone: impl Fn(&Endpoint) -> bool,
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
            self.close(id);
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
