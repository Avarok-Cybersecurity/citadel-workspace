//! Real CRDT bytes for the Documents tests: the relay decodes every update and snapshot, so
//! made-up bytes are refused before anything else is tested.

use cdoc_crdt::{blank, ClientId, Doc};

/// One editor's replica, opened blank as an editor opens a new document. Each edit returns the
/// update it makes, the bytes an editor appends.
pub struct Replica {
    doc: Doc,
}

impl Replica {
    pub fn new(client: u64) -> Self {
        Self {
            doc: blank(ClientId(client)).expect("a client other than the blank one"),
        }
    }

    /// Types `text` at the end; the update that edit makes.
    pub fn typed(&mut self, text: &str) -> Vec<u8> {
        let before = self.doc.state_vector();
        let end = self.doc.len();
        self.doc.insert_text(end, text).expect("type");
        self.doc.encode_diff(&before)
    }

    /// Takes in another replica's update.
    pub fn absorb(&mut self, update: &[u8]) {
        self.doc.apply_update(update).expect("apply");
    }

    /// A replica loaded from a snapshot, as a reader the server sent one has.
    pub fn from_snapshot(snapshot: &[u8]) -> Self {
        Self {
            doc: Doc::decode_snapshot(snapshot, ClientId(u64::MAX)).expect("a snapshot"),
        }
    }

    /// The update of an edit made after one this replica never sends: it decodes, but no
    /// replica given only it can integrate it.
    pub fn orphaned(&mut self, text: &str) -> Vec<u8> {
        let _unsent = self.typed(text);
        self.typed(text)
    }

    pub fn snapshot(&self) -> Vec<u8> {
        self.doc.encode_snapshot()
    }

    pub fn text(&self) -> String {
        self.doc.visible_text()
    }
}

/// An edit written as the blank document's own client, which no replica may write as.
pub fn update_as_blank_client() -> Vec<u8> {
    let mut doc = Doc::new(ClientId::BLANK);
    doc.insert_text(0, "forged base").expect("type");
    doc.encode_diff(&cdoc_crdt::StateVector::empty())
}

/// `n` successive edits by one replica writing as `client`, each its own update.
pub fn edits(client: u64, n: usize) -> Vec<Vec<u8>> {
    let mut replica = Replica::new(client);
    (0..n).map(|i| replica.typed(&format!("{i} "))).collect()
}

/// A real update of exactly `size_bytes`: one fresh replica typing filler. Lengths a single run
/// of ASCII cannot reach (where a length varint grows a byte) are met with a two-byte character.
pub fn update_of_size(client: u64, size_bytes: usize) -> Vec<u8> {
    // The bytes around the text of a one-character update; longer lengths add a few more.
    let overhead = Replica::new(client).typed("a").len() - 1;
    let longest = size_bytes.saturating_sub(overhead);
    for ascii in (longest.saturating_sub(16)..=longest).rev() {
        for wide in 0..2 {
            let text = format!("{}{}", "a".repeat(ascii), "é".repeat(wide));
            if text.is_empty() {
                continue;
            }
            let update = Replica::new(client).typed(&text);
            if update.len() == size_bytes {
                return update;
            }
        }
    }
    panic!("no update is {size_bytes} bytes");
}

/// A replica holding exactly `updates`, as a reader that applied them has.
pub fn replayed(updates: &[Vec<u8>]) -> Replica {
    let mut replica = Replica::new(u64::MAX);
    for update in updates {
        replica.absorb(update);
    }
    replica
}
