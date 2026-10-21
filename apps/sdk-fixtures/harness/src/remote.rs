//! The far end of an `ihttp` client call, as the reference host plays it when a run's `host`
//! states `ihttp_remote`. Whatever the app requests, once its request has ended the remote
//! answers status 200 and `chunks` body frames of `chunk_bytes` bytes (chunk `i` is filled with
//! byte `i % 256`), then End. It sends body frames only under the caller's credit:
//! IHTTP_INITIAL_CREDIT to start, one more per `IhttpConsumed` the app sends for the stream. A
//! body frame the app sends is consumed at once and credited back. Frames reach the app as
//! `AppEvent::Ihttp`, delivered by `Instance::pump`.

use citadel_app_sdk_types::abi::IHTTP_INITIAL_CREDIT;
use citadel_app_sdk_types::calls::*;
use citadel_app_sdk_types::{AppEvent, Bytes};
use std::collections::BTreeMap;

/// The remote's response, from the run's `host.ihttp_remote`.
#[derive(Clone, Copy, Debug)]
pub struct IhttpRemote {
    pub chunks: u32,
    pub chunk_bytes: u32,
}

struct Stream {
    from: Caller,
    credit: u32,
    sent: u32,
    answering: bool,
}

pub(crate) struct Remote {
    response: IhttpRemote,
    streams: BTreeMap<u64, Stream>,
}

/// The remote's identity, as its session would vouch for it to the app.
fn caller(to: &Address) -> Caller {
    let app_id = match to {
        Address::User { app_id, .. } | Address::Scope { app_id, .. } => app_id.clone(),
    };
    Caller {
        username: "bob".into(),
        cid: 2,
        app_id,
        install_id: "remote-install".into(),
        via: Via::P2p,
    }
}

impl Remote {
    pub(crate) fn new(response: IhttpRemote) -> Remote {
        Remote {
            response,
            streams: BTreeMap::new(),
        }
    }

    /// A client frame from the app; what the remote sends back goes to `out`.
    pub(crate) fn on_call(&mut self, call: &IhttpCall, out: &mut Vec<AppEvent>) {
        let id = call.frame.stream;
        match &call.frame.kind {
            FrameKind::RequestHead(_) => {
                let stream = Stream {
                    from: caller(&call.to),
                    credit: IHTTP_INITIAL_CREDIT,
                    sent: 0,
                    answering: false,
                };
                self.streams.insert(id, stream);
            }
            FrameKind::Body { .. } => {
                if let Some(s) = self.streams.get(&id) {
                    out.push(frame(&s.from, id, FrameKind::Credit { n: 1 }));
                }
            }
            FrameKind::End => {
                let total = u64::from(self.response.chunks) * u64::from(self.response.chunk_bytes);
                if let Some(s) = self.streams.get_mut(&id) {
                    s.answering = true;
                    let head = ResponseHead {
                        status: 200,
                        headers: vec![],
                        body_len: Some(total),
                    };
                    out.push(frame(&s.from, id, FrameKind::ResponseHead(head)));
                }
                self.send(id, out);
            }
            FrameKind::Cancel { .. } => {
                self.streams.remove(&id);
            }
            FrameKind::ResponseHead(_) | FrameKind::Credit { .. } => {}
        }
    }

    /// The app read one body chunk of `stream`: one more credit. Unknown streams are ignored.
    ///
    pub(crate) fn on_consumed(&mut self, consumed: &IhttpConsumed, out: &mut Vec<AppEvent>) {
        if let Some(s) = self.streams.get_mut(&consumed.stream) {
            s.credit += 1;
        }
        self.send(consumed.stream, out);
    }

    fn send(&mut self, id: u64, out: &mut Vec<AppEvent>) {
        let IhttpRemote {
            chunks,
            chunk_bytes,
        } = self.response;
        let Some(s) = self.streams.get_mut(&id).filter(|s| s.answering) else {
            return;
        };
        while s.credit > 0 && s.sent < chunks {
            let bytes = Bytes(vec![(s.sent % 256) as u8; chunk_bytes as usize]);
            out.push(frame(&s.from, id, FrameKind::Body { bytes }));
            s.credit -= 1;
            s.sent += 1;
        }
        if s.sent == chunks {
            out.push(frame(&s.from, id, FrameKind::End));
            self.streams.remove(&id);
        }
    }
}

fn frame(from: &Caller, stream: u64, kind: FrameKind) -> AppEvent {
    AppEvent::Ihttp {
        from: from.clone(),
        frame: IhttpFrame::new(stream, kind),
    }
}
