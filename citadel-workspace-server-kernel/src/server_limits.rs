//! What a workspace server holds for connections that have not signed in, how it takes legacy
//! registrations, and how much its streams may queue. The SDK has no default (it refuses to start
//! a server without them, `NodeBuilder::with_server_limits`); both hosts, the native server and
//! the tenant Durable Object, take them from here.
//!
//! @human-review: these values are this lane's choice, not yet the owner's. They are sized for the
//! smaller host, a Durable Object (32-bit WASM, 128 MB): a queue total it can hold, and two
//! legacy Argon2 hashes at once, so a burst of old clients cannot exhaust its memory.

use citadel_sdk::prelude::{LegacyRegistration, ServerLimits};
use std::num::NonZeroUsize;

/// Connections from one address that have not signed in yet: an office behind one NAT, each
/// person's agent dialling at once.
const PROVISIONAL_PER_IP: usize = 32;
/// Such connections held in all.
const PROVISIONAL_TOTAL: usize = 512;
/// Legacy registrations (a client below post-quantum sign-in, whose password the server hashes)
/// hashing at once. Older agents still register this way, so they are taken, not refused.
const LEGACY_CONCURRENT_HASHES: usize = 2;
const MIB: usize = 1024 * 1024;
/// Bytes queued for one client that is not reading.
const OUTBOUND_QUEUED_PER_STREAM: usize = 16 * MIB;
/// Bytes queued for every client together; past it the stream holding the most is ended.
const OUTBOUND_QUEUED_TOTAL: usize = 64 * MIB;

fn positive(n: usize) -> NonZeroUsize {
    NonZeroUsize::new(n).expect("every server limit above is a positive constant")
}

/// The limits every workspace server runs with.
pub fn production_server_limits() -> ServerLimits {
    ServerLimits {
        provisional_per_ip: positive(PROVISIONAL_PER_IP),
        provisional_total: positive(PROVISIONAL_TOTAL),
        legacy_registration: LegacyRegistration::Accepted {
            concurrent_hashes: positive(LEGACY_CONCURRENT_HASHES),
        },
        outbound_queued_per_stream: positive(OUTBOUND_QUEUED_PER_STREAM),
        outbound_queued_total: positive(OUTBOUND_QUEUED_TOTAL),
    }
}
