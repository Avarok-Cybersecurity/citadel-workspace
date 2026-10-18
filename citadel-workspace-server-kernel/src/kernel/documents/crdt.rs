//! What the relay reads from the CRDT bytes it stores. `cdoc-crdt` decodes them in full; the
//! relay never applies them, so it holds no replica and no document text.

use cdoc_crdt::{ClientId, Doc, StateVector};
use std::collections::BTreeMap;

/// A state vector in the form the log head stores: each CRDT client id, and the first of its
/// clocks not held. A client absent holds nothing.
pub(crate) type Clocks = BTreeMap<u64, u64>;

pub(crate) fn clocks(sv: &StateVector) -> Clocks {
    sv.iter().map(|(client, next)| (client.0, next)).collect()
}

/// The clients an update writes as, each with the end of the highest clock it writes. Every
/// operation is decoded, so bytes a replica could not apply are refused here, before they are
/// stored or relayed. `Err` is the decoder's reason.
pub(crate) fn update_clocks(update: &[u8]) -> Result<Clocks, String> {
    cdoc_crdt::update_writes(update)
        .map(|writes| clocks(&writes.version()))
        .map_err(|e| e.to_string())
}

/// The state vector a snapshot holds. Loaded in full, not read from its header: a snapshot
/// whose body is damaged would otherwise be served to every reader older than it. The relay
/// never writes into the replica, so the client it would write as is the blank one.
pub(crate) fn snapshot_clocks(snapshot: &[u8]) -> Result<Clocks, String> {
    Doc::decode_snapshot(snapshot, ClientId::BLANK)
        .map(|doc| clocks(&doc.state_vector()))
        .map_err(|e| e.to_string())
}

/// `into` raised to hold everything `from` holds.
pub(crate) fn merge(into: &mut Clocks, from: &Clocks) {
    for (&client, &next) in from {
        let held = into.entry(client).or_insert(0);
        *held = (*held).max(next);
    }
}

/// The first client whose clocks `needed` holds further than `held` does, with both ends.
pub(crate) fn first_uncovered(needed: &Clocks, held: &Clocks) -> Option<(u64, u64, u64)> {
    needed.iter().find_map(|(&client, &next)| {
        let have = held.get(&client).copied().unwrap_or(0);
        (have < next).then_some((client, next, have))
    })
}

/// The reserved client of the blank document's base items. No replica writes as it.
pub(crate) const RESERVED_CLIENT: u64 = ClientId::BLANK.0;
