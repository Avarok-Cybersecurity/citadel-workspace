//! The internal-HTTP relay's state (R4.4), pure: which sessions serve which install until when,
//! and the streams relayed between a caller's session and a serving one.
//!
//! An install is reachable through the relay only from a session that advertised it, as a peer
//! is reachable over P2P only once its ILM capabilities carry `INTERNAL_HTTP`: unadvertised is
//! unreachable. Advertisements (`ihttp_adverts`) and streams live in memory with the sessions
//! that made them, and end with them, with the instance that withdraws, or with the install
//! (`ihttp_relay_end`).
//!
//! The relay renumbers streams: the serving session sees ids the relay allocated, unique on its
//! connection and increasing, so two callers who both chose stream 1 never collide there.

use super::ihttp_adverts::Adverts;
use super::ihttp_flow::{Side, StreamFlow};
pub use super::ihttp_relay_types::{Endpoint, Forward, RelayFault, RelayHandle};
use citadel_ihttp_types::{
    IhttpFrameKind, MAX_STREAMS_PER_CALLER, MAX_STREAMS_PER_SERVER, STREAMING_TIMEOUT_MS,
    STREAM_TIMEOUT_MS,
};
use std::collections::HashMap;

/// How far ahead an advertisement may run; the host repeats it every 60 s while mounted.
pub const MAX_ADVERT_MS: u64 = 120_000;
/// Set on every id the relay allocates and on none a caller may choose, so a frame's stream id
/// says which end sent it even when one session is both a caller and a server of one install.
pub const RELAY_STREAM_BIT: u64 = 1 << 63;

#[derive(Debug, Clone)]
pub(super) struct RelayStream {
    pub(super) client: Endpoint,
    pub(super) client_stream: u64,
    pub(super) server: Endpoint,
    opened_ms: u64,
    deadline_ms: u64,
    flow: StreamFlow,
}

/// Caller's `(cid, install id, stream id)`.
type ClientKey = (u64, String, u64);

#[derive(Debug, Default)]
pub struct IhttpRelay {
    pub(super) adverts: Adverts,
    /// Relay stream id (unique, increasing) to the stream.
    pub(super) streams: HashMap<u64, RelayStream>,
    by_client: HashMap<ClientKey, u64>,
    next_id: u64,
}

impl IhttpRelay {
    /// `cid`, signed in as `username`, serves `install_id` until `until_ms`, for `instance`.
    pub fn advertise(
        &mut self,
        install_id: &str,
        cid: u64,
        username: &str,
        instance: &str,
        until_ms: u64,
        now_ms: u64,
    ) -> Result<(), RelayFault> {
        if until_ms <= now_ms || until_ms - now_ms > MAX_ADVERT_MS {
            return Err(RelayFault::AdvertWindow);
        }
        self.expire(now_ms);
        self.adverts
            .advertise(install_id, cid, username, instance, until_ms)
    }

    /// A session serving `install_id` now (as `username`, if given): the one advertised
    /// furthest ahead. Its cid and username.
    pub fn host(
        &self,
        install_id: &str,
        username: Option<&str>,
        now_ms: u64,
    ) -> Option<(u64, String)> {
        self.adverts.host(install_id, username, now_ms)
    }

    /// Open a stream from `client` (its id `client_stream`) to `server`, whose `RequestHead`
    /// declared `body_len`. Answers the id the server sees.
    pub fn open(
        &mut self,
        client: Endpoint,
        client_stream: u64,
        server: Endpoint,
        body_len: Option<u64>,
        now_ms: u64,
    ) -> Result<u64, RelayFault> {
        self.expire(now_ms);
        if client_stream & RELAY_STREAM_BIT != 0 {
            return Err(RelayFault::RelayStreamId);
        }
        let key = (client.cid, client.install_id.clone(), client_stream);
        if self.by_client.contains_key(&key) {
            return Err(RelayFault::StreamInUse);
        }
        let at_server = self.streams.values().filter(|s| s.server.cid == server.cid);
        let (mut pair, mut total) = (0u32, 0u32);
        for stream in at_server {
            total += 1;
            pair += u32::from(stream.client.cid == client.cid);
        }
        if pair >= MAX_STREAMS_PER_CALLER || total >= MAX_STREAMS_PER_SERVER {
            return Err(RelayFault::Busy);
        }
        self.next_id += 1;
        let id = RELAY_STREAM_BIT | self.next_id;
        self.by_client.insert(key, id);
        let stream = RelayStream {
            client,
            client_stream,
            server,
            opened_ms: now_ms,
            deadline_ms: now_ms + STREAM_TIMEOUT_MS,
            flow: StreamFlow::opened(body_len),
        };
        self.streams.insert(id, stream);
        Ok(id)
    }

    /// A frame the caller sends on its stream `client_stream`.
    pub fn from_client(
        &mut self,
        cid: u64,
        install_id: &str,
        client_stream: u64,
        kind: &IhttpFrameKind,
        now_ms: u64,
    ) -> Result<Forward, RelayFault> {
        self.expire(now_ms);
        let key = (cid, install_id.to_string(), client_stream);
        let id = *self.by_client.get(&key).ok_or(RelayFault::NoStream)?;
        self.pass(id, Side::Client, kind, now_ms)
    }

    /// A frame the serving session sends on the stream the relay numbered `id`.
    pub fn from_server(
        &mut self,
        cid: u64,
        install_id: &str,
        id: u64,
        kind: &IhttpFrameKind,
        now_ms: u64,
    ) -> Result<Forward, RelayFault> {
        self.expire(now_ms);
        let served = self
            .streams
            .get(&id)
            .is_some_and(|s| s.server.cid == cid && s.server.install_id == install_id);
        if !served {
            return Err(RelayFault::NoStream);
        }
        self.pass(id, Side::Server, kind, now_ms)
    }

    fn pass(
        &mut self,
        id: u64,
        side: Side,
        kind: &IhttpFrameKind,
        now_ms: u64,
    ) -> Result<Forward, RelayFault> {
        let stream = self.streams.get_mut(&id).ok_or(RelayFault::NoStream)?;
        stream.flow.admit(side, kind).map_err(RelayFault::Flow)?;
        if matches!(kind, IhttpFrameKind::Credit { .. }) {
            let streaming = stream.opened_ms + STREAMING_TIMEOUT_MS;
            stream.deadline_ms = stream
                .deadline_ms
                .max((now_ms + STREAM_TIMEOUT_MS).min(streaming));
        }
        let forward = match side {
            Side::Client => Forward {
                from: stream.client.clone(),
                to: stream.server.clone(),
                stream: id,
            },
            Side::Server => Forward {
                from: stream.server.clone(),
                to: stream.client.clone(),
                stream: stream.client_stream,
            },
        };
        if stream.flow.is_over() {
            self.close(id);
        }
        Ok(forward)
    }

    pub(super) fn close(&mut self, id: u64) {
        if let Some(stream) = self.streams.remove(&id) {
            let key = (
                stream.client.cid,
                stream.client.install_id,
                stream.client_stream,
            );
            self.by_client.remove(&key);
        }
    }

    /// Drop advertisements and streams whose time is up.
    pub fn expire(&mut self, now_ms: u64) {
        self.adverts.expire(now_ms);
        let over: Vec<u64> = self
            .streams
            .iter()
            .filter(|(_, s)| s.deadline_ms <= now_ms)
            .map(|(id, _)| *id)
            .collect();
        over.into_iter().for_each(|id| self.close(id));
    }
}
