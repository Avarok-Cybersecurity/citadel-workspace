//! What the reference host answers for a call that is granted. Only the ports the fixtures need
//! exist; every other op is `unavailable`, which is distinct from `ungranted` on purpose.

use crate::state::State;
use citadel_app_sdk_types::calls::*;
use citadel_app_sdk_types::ops::{
    CanvasOps, EventsOps, FilesOps, IhttpOps, LogOps, NavigateOps, StorageOps, UiOps,
};
use citadel_app_sdk_types::{encode, Bytes, HostCall, HostReply, Refused};

fn ok<T: serde::Serialize>(value: T) -> Vec<u8> {
    encode(&HostReply::Ok(value))
}

pub fn refused(r: Refused) -> Vec<u8> {
    encode(&HostReply::<()>::Refused(r))
}

pub fn respond(state: &mut State, call: &HostCall) -> Vec<u8> {
    if let (HostCall::Ihttp(op), Some(remote)) = (call, state.remote.as_mut()) {
        match op {
            IhttpOps::IhttpCall(c) => {
                remote.on_call(c, &mut state.inbound);
                return ok(());
            }
            IhttpOps::IhttpConsumed(c) => {
                remote.on_consumed(c, &mut state.inbound);
                return ok(());
            }
            IhttpOps::IhttpServe(_) | IhttpOps::IhttpRespond(_) => {}
        }
    }
    match call {
        HostCall::Log(LogOps::LogWrite(w)) => {
            state.log.push(w.message.clone());
            ok(())
        }
        HostCall::Canvas(CanvasOps::CanvasMeasure(_)) => ok(CanvasSize {
            width: 320,
            height: 200,
            dpr: 1.0,
        }),
        HostCall::Canvas(CanvasOps::CanvasDraw(_)) | HostCall::Events(EventsOps::Subscribe(_)) => {
            ok(())
        }
        HostCall::Events(EventsOps::RequestFrames(_)) | HostCall::Ui(UiOps::ShowToast(_)) => ok(()),
        // Internal links only: a path on this origin.
        HostCall::Navigate(NavigateOps::NavigateOpen(n))
            if n.href.starts_with('/') && !n.href.starts_with("//") =>
        {
            ok(())
        }
        HostCall::Navigate(_) => refused(Refused::Policy("not_an_internal_link".into())),
        HostCall::Files(FilesOps::FilesRead(r)) if r.len > state.limits.max_reply_bytes => {
            refused(Refused::Limit("read_len".into()))
        }
        HostCall::Storage(StorageOps::KvGet(g)) if g.backend == KvBackend::User => ok(KvValue {
            value: state.kv.get(&g.key).cloned().map(Bytes),
        }),
        HostCall::Storage(StorageOps::KvSet(s)) if s.backend == KvBackend::User => {
            state.kv.insert(s.key.clone(), s.value.0.clone());
            ok(())
        }
        HostCall::Files(FilesOps::FilesRead(r)) => ok(BytesValue {
            bytes: Bytes(vec![0; r.len as usize]),
        }),
        _ => refused(Refused::Unavailable("no port in the reference host".into())),
    }
}
