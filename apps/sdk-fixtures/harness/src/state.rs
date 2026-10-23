//! The host's per-instance state and the ABI's import functions: the groups, `reply_len`
//! and `reply_read`. See [`crate::host`] for the semantics they implement.

use crate::remote::{IhttpRemote, Remote};
use crate::respond::{refused, respond};
use citadel_app_sdk_types::abi::{self, AbiError};
use citadel_app_sdk_types::ops::CallDecodeError;
use citadel_app_sdk_types::{AppEvent, Capability, Group, HostCall, LifecycleState, Refused};
use std::collections::BTreeMap;
use wasmi::{Caller, Memory};

/// The host's policy for one instance. Every limit is explicit.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_memory_pages: u32,
    pub max_request_bytes: u32,
    pub max_reply_bytes: u32,
    pub fuel_per_call: u64,
    /// The close grace, metered in fuel: `app_close` and the replies it waits on share it.
    pub close_grace_fuel: u64,
    /// The far end of the app's ihttp client calls; None: there is none (`unavailable`).
    pub ihttp_remote: Option<IhttpRemote>,
}

pub struct State {
    pub(crate) granted: Vec<Capability>,
    pub limits: Limits,
    pub(crate) memory: Option<Memory>,
    /// `None` while pending.
    pub(crate) replies: BTreeMap<i32, Option<Vec<u8>>>,
    /// Pending handles and the reply each will resolve to, in issue order.
    pub(crate) to_resolve: Vec<(i32, Vec<u8>)>,
    pub(crate) next_handle: i32,
    pub(crate) remote: Option<Remote>,
    /// Events for the app that `pump` delivers after the replies (the remote's ihttp frames).
    pub(crate) inbound: Vec<AppEvent>,
    pub log: Vec<String>,
    pub calls: Vec<HostCall>,
    /// The instance's lifecycle, as the host runs it; it gates every call first.
    pub lifecycle: LifecycleState,
    /// `storage.user`, the one backend the reference host serves.
    pub(crate) kv: BTreeMap<String, Vec<u8>>,
}

impl State {
    fn issue(&mut self, reply: Option<Vec<u8>>) -> i32 {
        let handle = self.next_handle;
        self.next_handle += 1;
        self.replies.insert(handle, reply);
        handle
    }

    fn holds(&self, cap: Capability) -> bool {
        cap.is_intrinsic() || self.granted.contains(&cap)
    }

    fn capped(&self, reply: Vec<u8>) -> Vec<u8> {
        if reply.len() > self.limits.max_reply_bytes as usize {
            return refused(Refused::Limit("reply_bytes".into()));
        }
        reply
    }
}

/// `ptr..ptr+len` as a range of `memory`, or None.
fn span(memory_len: usize, ptr: i32, len: i32) -> Option<std::ops::Range<usize>> {
    let start = ptr as u32 as usize;
    let len = usize::try_from(len).ok()?;
    let end = start.checked_add(len)?;
    (end <= memory_len).then_some(start..end)
}

pub(crate) fn group_call(
    mut caller: Caller<'_, State>,
    group: Group,
    op: i32,
    ptr: i32,
    len: i32,
) -> i32 {
    if let Some(why) = caller.data().lifecycle.refusal_for(group) {
        let reply = refused(Refused::Unavailable(why.into()));
        return caller.data_mut().issue(Some(reply));
    }
    let opens = |s: &State| {
        Capability::ALL
            .iter()
            .any(|c| c.group() == group && s.holds(*c))
    };
    if !opens(caller.data()) {
        return caller.data_mut().issue(Some(refused(Refused::Ungranted)));
    }
    let memory = caller.data().memory.expect("memory is linked");
    let data = memory.data(&caller);
    let Some(range) = span(data.len(), ptr, len) else {
        return AbiError::BadRequest.code();
    };
    let too_large = range.len() > caller.data().limits.max_request_bytes as usize;
    let payload = data[range].to_vec();
    let state = caller.data_mut();
    let call = match HostCall::decode(group, op, &payload) {
        _ if too_large => {
            return state.issue(Some(refused(Refused::Limit(
                abi::REFUSED_REQUEST_BYTES.into(),
            ))))
        }
        Ok(call) => call,
        Err(CallDecodeError::UnknownOp) => {
            return state.issue(Some(refused(Refused::Policy(
                abi::REFUSED_UNKNOWN_OP.into(),
            ))))
        }
        Err(CallDecodeError::Malformed(_)) => {
            return state.issue(Some(refused(Refused::Policy(
                abi::REFUSED_BAD_ARGUMENTS.into(),
            ))))
        }
    };
    state.calls.push(call.clone());
    if !call.is_granted(|c| state.holds(c)) {
        return state.issue(Some(refused(Refused::Ungranted)));
    }
    let reply = respond(state, &call);
    let reply = state.capped(reply);
    if matches!(group, Group::Canvas | Group::Log | Group::Navigate) {
        return state.issue(Some(reply));
    }
    let handle = state.issue(None);
    state.to_resolve.push((handle, reply));
    handle
}

pub(crate) fn reply_read(mut caller: Caller<'_, State>, handle: i32, ptr: i32, cap: i32) -> i32 {
    let len = match caller.data().replies.get(&handle) {
        None => return AbiError::UnknownHandle.code(),
        Some(None) => return AbiError::Pending.code(),
        Some(Some(r)) => r.len(),
    };
    if (cap as u32 as usize) < len {
        return AbiError::BufferTooSmall.code();
    }
    let memory = caller.data().memory.expect("memory is linked");
    let Some(range) = span(memory.data(&caller).len(), ptr, len as i32) else {
        return AbiError::BadRequest.code();
    };
    let reply = caller
        .data_mut()
        .replies
        .remove(&handle)
        .flatten()
        .expect("checked above");
    memory.data_mut(&mut caller)[range].copy_from_slice(&reply);
    len as i32
}

pub(crate) fn reply_len(c: Caller<'_, State>, h: i32) -> i32 {
    match c.data().replies.get(&h) {
        None => AbiError::UnknownHandle.code(),
        Some(None) => AbiError::Pending.code(),
        Some(Some(r)) => r.len() as i32,
    }
}
