# Contract: VFS wire (kernel protocol, pair sync, routing) — FROZEN 2026-11-24, revised round 2

Parties: V2 (kernel), V3 (client replicas, pair sync), V8 (group sync), V5 (documents in
volumes), V6 (the kernel's `fs` arm reads the same store). Ops as bytes: `vfs-ops.md` §2
(`SignedOp`). Fixtures: `fixtures/routing/`, `fixtures/codec/`.

## 1. Where each volume's ops travel

| Volume | Carried by | Encoding of the carrier |
|---|---|---|
| Personal, Node | `WorkspaceProtocolRequest::Vfs` / `WorkspaceProtocolResponse::Vfs` (§2, §3) | the workspace protocol's own |
| Pair | `P2PCommandType.VfsSync` over the reliable P2P channel (§4) | `cbor-x`, as every `P2PCommand` |
| Group | an ordered group broadcast (`vfs-group.md`) | `cbor-x` |
| Device | nowhere: one replica, the agent's LocalDB | — |

Inside every carrier an op is the same canonical `SignedOp` byte string.

## 2. `VfsAddress` and the envelope (a new module `vfs` of `citadel-workspace-types`)

```rust
pub enum VfsAddress { Personal, Node { node_id: String } }      // Personal = the caller's own
pub struct VfsRequest  { pub volume: VfsAddress, pub via: Option<AppVia>, pub call: VfsCall }
pub struct AppVia      { pub install_id: String }           // set when an app's `fs` call caused it (fs-abi §5)
pub struct VfsResponse { pub volume_id: String,  pub answer: VfsAnswer }   // "personal:<cid>" | "node:<id>"

WorkspaceProtocolRequest::Vfs(vfs::VfsRequest)
WorkspaceProtocolResponse::Vfs(vfs::VfsResponse)
```
The address is an envelope, as `ChatDocumentsRequest`'s is: every answer, push and refusal names
its volume, because the protocol has no request id. Derives, `ts(export)` and
`plaintext_debug_fmt` on every byte field as in `documents.rs`. `citadel-workspace-types` takes
`citadel-vfs` as a path dependency (as it takes `citadel-identity`) and re-exports `Denied`.

## 3. Calls, answers, pushes, refusals

```rust
pub enum VfsCall {
    /// 1..=max_append_ops SignedOps, admitted in order, all or none (vfs-ops §4 "admission").
    Append { ops: Vec<Vec<u8>>, client_seq: u64 },
    /// Everything after `since_seq` (0 = the whole log), a page at a time.
    Pull { since_seq: u64 },
    /// The kernel's own fold of the log, for a first paint only (§3.3).
    Snapshot,
    /// The keys behind these fingerprints (vfs-signing §3). 1..=64.
    Keys { fps: Vec<String> },
    UploadChunk { sha256: String, size_bytes: u64, index: u32, total_chunks: u32, bytes: Vec<u8> },
    /// Chunk `index` of the bytes entry `inode` (32 hex) points at now; `sha256` is what the
    /// caller believes that is.
    ReadChunk { inode: String, sha256: String, index: u32 },
    /// An outsider's calls (vfs-outsiders §5, §6); `root` is the admitted entry (32 hex).
    OutsideClaim { token: String, claim: Vec<u8>, proof: Vec<u8> },
    OutsideView { root: String, since_seq: u64 },
    OutsideAppend { root: String, ops: Vec<Vec<u8>>, client_seq: u64 },
}

pub struct VfsLogEntry { pub seq: u64, pub op: Vec<u8> }
pub struct VfsKey { pub id_fp: String, pub pk: Vec<u8> }

pub enum VfsAnswer {
    Appended { first_seq: u64, count: u32, client_seq: u64 },
    Ops { ops: Vec<VfsLogEntry>, has_more: bool, latest_seq: u64 },
    SnapshotIs { upto_seq: u64, tree: Vec<u8> },
    KeysAre { keys: Vec<VfsKey> },
    ChunkStored { sha256: String, index: u32, stored: bool },
    Chunk { inode: String, sha256: String, index: u32, total_chunks: u32, size_bytes: u64, bytes: Vec<u8> },
    /// PUSH: ops another session appended, to every other session that may read the volume.
    OpsAppended { ops: Vec<VfsLogEntry> },
    /// The admitted subtree as canonical `Entry` maps (§3.3), then the ops on it after `since_seq`.
    OutsideViewIs { root: String, upto_seq: u64, entries: Vec<Vec<u8>>, ops: Vec<VfsLogEntry>, has_more: bool },
    /// The session is now bound to this admission; `nonce` is what a returning guest signs next time.
    OutsideBound { root: String, nonce: Vec<u8> },
    Refused { client_seq: Option<u64>, index: Option<u32>, refusal: VfsRefusal },
}

pub enum VfsRefusal {
    /// No such volume, or the caller is not a member of it: one answer.
    NoSuchVolume,
    Denied(citadel_vfs::Denied),
    BadSignature, UnknownKey, NotAuthor, Invalid, Skew, Duplicate,
    StalePrev { expected: Option<Vec<u8>> }, StaleStamp { latest: u64 },
    AlreadyExists { id: bool }, NoParent, Cycle, NotEmpty, Purged,
    Limit(VfsLimit), BlobMissing, BlobMismatch, BadChunk,
    TooLarge { max_bytes: u64 }, StorageFull, Unsupported, Unavailable,
    /// `via` named an install that may not make this call (fs-abi §5).
    App(apps_install::AppsRefusal),
}
pub enum VfsLimit { Entries, EntriesPerDir, Depth, LogOps, OpsPerMinute, AppendOps }
```

### 3.1 Rules
- Membership is read by the kernel at every call: Personal → the session's account, holding a
  role and not banned; Node → `ViewContent` on the node. Otherwise `NoSuchVolume`.
- `Append`: the checks of `vfs-ops.md` §4 in that order; `index` names the op that failed. There
  is **no purge request**: Delete Forever is an `Append` of `Purge` ops, after which the kernel
  deletes bytes and redacts bodies (`vfs-ops.md` §5). The kernel appends its own ops (app homes,
  migration, retention purge) through the same admission, signed as `Server`.
- `Pull` returns at most `max_ops_per_pull` entries in `seq` order; a redacted op arrives with a
  empty body. `latest_seq` lets a reader see it is behind.
- `OpsAppended` is pushed to every other session of every member, the appender's other sessions
  included; a reader that sees a gap in `seq` pulls.
- A `LiveDoc` pointee in a Node volume is the node's chat document of that id
  (`ChatDocumentsRequest { chat_doc: doc_id, .. }`, unchanged). In a Personal volume a `LiveDoc`
  is refused `Unsupported` unless the optional item below is built.
- **Optional (V5, only if the kernel address is cheap; otherwise next release):** a document in
  a Personal volume is addressed `WorkspaceProtocolRequest::VfsDocuments(VfsDocumentsRequest {
  volume: VfsAddress, doc_id: String, request: DocumentsRequest })`, answered
  `VfsDocumentsResponse { volume_id, doc_id, answer: DocumentsResponse }`; the request's own
  `node_id` must be empty; the kernel's document address gains a third form (the volume id and
  the document id) with its own key prefix; reading needs `may_read_bytes` on the entry whose
  pointee is `LiveDoc { doc_id }`, writing `bit(W)` and `role.upload`. Until it exists nothing
  sends `VfsDocuments`.
- An outsider's calls: `OutsideClaim` carries the link's token and either a `Claim` op (`proof`
  empty) or, for a guest that claimed before, an empty `claim` and `proof` = its invitation
  key's signature over `"citadel-vfs-resume-v1" ‖ 0x00 ‖ nonce` for the nonce it was last
  given. `OutsideView` and `OutsideAppend` are `Pull` and `Append` narrowed to the admitted
  subtree; a workspace member admitted as kind A calls them on its ordinary session. A
  transient session is served nothing else: `vfs-outsiders.md` §6
  (`WorkspaceProtocolResponse::TransientRefused(TransientRefusal)`).

### 3.2 Bytes: binding an upload to an op, and reading
- Chunks are `VFS_CHUNK_BYTES = ARTIFACT_CHUNK_BYTES` (256 KiB), the last shorter;
  `chat_attachments::check_upload_chunk` is the shape rule (`BadChunk`). A file over
  `[vfs] max_blob_bytes` is `TooLarge`; one that would pass the workspace's storage is
  `StorageFull` (removed entries count until purged).
- An upload is **staged** for its uploader and volume. The chunk that completes it is hashed;
  a digest other than `sha256` discards it (`BlobMismatch`). A staged blob no admitted op names
  within `staged_blob_grace_ms` is deleted.
- An op carrying `Standard { sha256, len, .. }` is admitted only if `len` is the stored size and
  either the author staged that blob for this volume, or the volume's store already holds it and
  the author passes `may_read_bytes` on an entry naming it (a same-volume copy moves no bytes).
  Otherwise `BlobMissing` / `BlobMismatch`. `len == 0` needs no upload and must carry the SHA-256
  of the empty string.
- `ReadChunk` runs `may_read_bytes` against the kernel's tree **at the time of each chunk**, and
  requires the entry's pointee to be `Standard` with that `sha256` (else `Denied` /
  `BlobMissing`). RE-VFS bytes never travel here: their owner uses the existing `SendFile`
  (`TransferType::RemoteEncryptedVirtualFilesystem`), `DownloadFile` and `DeleteVirtualFile`.

### 3.3 Snapshot
`tree` is the canonical CBOR (rules of `vfs-ops.md` §2) of
```
TreeSnapshot = { 1: v = 1, 2: volume tstr, 3: upto_seq uint, 4: [Entry …] sorted by id, 5: [purged id bstr(16) …] sorted }
Entry        = { 1: id, 2: kind, 3: [created.by, created.at_ms], 4: [parent, name, Stamp], 5: [Pointee, Stamp],
                 6: [owner, Stamp], 7: [mode, Stamp], 8: [removal.by, removal.at_ms, Stamp] | [] }     ([] = never removed or restored)
Stamp        = [lamport, author, op_id]
```
It is the kernel's statement and carries no author's signature: a client may paint from it, and
must pull and verify the log before it marks the volume `Verified` or lets the person write.

## 4. Pair volumes: `VfsSync` (P2P)

```ts
// types/p2p-commands.ts
P2PCommandType.VfsSync = "VfsSync"            // payload: VfsSyncPayload
// a new module `vfs-sync` beside cdoc-chat-sync.ts; bytes are CBOR byte strings, as there
export interface VfsSyncPayload { readonly volume: string; readonly v: 1; readonly sync: VfsSync }
export type VfsSync =
  | { readonly kind: 'hello'; readonly tips: readonly Uint8Array[]; readonly count: number; readonly answer: boolean }
  | { readonly kind: 'ops'; readonly ops: readonly Uint8Array[]; readonly index: number; readonly total: number }
  | { readonly kind: 'want'; readonly hashes: readonly Uint8Array[] }
  | { readonly kind: 'key'; readonly pk: Uint8Array }
  | { readonly kind: 'refused'; readonly op_hash: Uint8Array; readonly reason: string }
  | { readonly kind: 'have'; readonly sha256: readonly Uint8Array[] }
  | { readonly kind: 'fetch'; readonly sha256: Uint8Array }
  | { readonly kind: 'fetch-refused'; readonly sha256: Uint8Array; readonly reason: 'not_held' | 'denied' }
  | { readonly kind: 'outside-hello'; readonly root: Uint8Array; readonly claim: Uint8Array | null }
  | { readonly kind: 'outside-view'; readonly root: Uint8Array; readonly entries: readonly Uint8Array[]; readonly index: number; readonly total: number }
  | { readonly kind: 'outside-ops'; readonly root: Uint8Array; readonly ops: readonly Uint8Array[] }
  | { readonly kind: 'state'; readonly nonce: Uint8Array; readonly chunk: Uint8Array; readonly index: number; readonly total: number };
```
Everything read came from the peer: every field is checked and every byte string copied, as
`chat-wire.ts` does; a payload that is not this shape is reported, never guessed at.

- **Tips.** A replica's tips are the `op_hash`es of the ops it holds that no held op names as
  `prev` (one per author, more when an account wrote on two devices). At most `VFS_MAX_TIPS =
  64`.
- **hello.** Sent when the volume is opened and on every (re)connect. The receiver sends, as
  `ops` chunks in stamp order, every op it holds that is not an ancestor (through `prev`) of a
  tip in the hello. If the hello names a tip it does not hold and `answer` is false, it also
  sends its own hello with `answer: true`.
- **ops.** A new op is sent at once as `{ ops: [op], index: 0, total: 1 }`; an answer to a hello
  is chunks of at most `VFS_P2P_CHUNK_OPS = 16`. The receiver ingests each op by
  `vfs-ops.md` §4 ("ingestion"); one it refuses is answered `refused`.
- **want.** For a pending op whose `prev` is missing: the peer answers with those ops if it
  holds them.
- **key.** The sender's identity key, sent with its first hello on a connection
  (`vfs-signing.md` §3).
- **Bytes.** `have` announces Standard blobs the sender holds. `fetch` asks for one: the holder
  checks `may_read_bytes` for the asker on an entry naming it, then sends the file with the
  standard transfer (`SendFile`, `TransferType::FileTransfer`) under the name
  `citadel-vfs-<64 hex sha256>`. The asker accepts without a prompt only a transfer of that name
  it has a pending `fetch` for from that peer, and keeps it only if it hashes to the name.
  RE-VFS objects use the existing RE-VFS requests between owner and host.
- **Outsiders** (`vfs-outsiders.md` §5): `outside-hello` opens a P2P conversation between an
  outsider and a member's device about the admitted entry `root` (with the `Claim` op the first
  time); the member answers `outside-view` (the subtree's `Entry` maps) and from then on sends
  `outside-ops` for ops on it; the outsider sends its own ops as `outside-ops`. The member's
  device judges each with `authorize` before taking it in.
- `state` carries a group volume's state transfer (`vfs-group.md` §4) between two members.
- The log, the pending ops and the blob index are kept in the agent's LocalDB under
  `vfs:<account>:<volume>#…` (V3 names the sub-keys; the prefix is frozen).

## 5. Group volumes

`vfs-group.md`: the order (the SDK group's `seq`), judging at a position, the message framing,
catching up, state transfer, and what lane SDK-ORDER must provide.

## 6. Routing in the page (`citadel-workspaces/src/lib/multi-instance/routing-rules.ts`)

| What arrives | Agent response type | Routed by | Change to `CID_ROUTED_NOTIFICATIONS` |
|---|---|---|---|
| a kernel push or answer (`WorkspaceProtocolResponse::Vfs`) | `MessageNotification` | `cid` | none: already a member, fixture exists |
| a pair `VfsSync` | `MessageNotification` | `cid` | none |
| a group VFS message | `GroupMessageNotification` | `cid` | none |
| a group's membership, ownership, fetch and "trimmed" answers | provided by lane SDK-ORDER | `cid` where unsolicited | added by SDK-ORDER with their fixtures (`vfs-group.md` §5, item 11) |
| a signing answer | `VfsOpsSigned`, `VfsSignFailure` | `request_id` (they answer a request the asking tab issued) | **none: they must not be added** |

The VFS lanes add **no** member to `CID_ROUTED_NOTIFICATIONS`. `fixtures/routing/shapes.json`
holds the two signing answers' shapes for the test that says so: each has a `request_id`, and
`routeByRequestId` delivers it to the tab that asked. If a later change makes the agent send an
unsolicited VFS response, it joins the set with a `SHAPES` entry in
`cid-routed-notifications.test.ts` and an entry in that test's written-out list, in one change.

## 7. Size caps (all named; `citadel-vfs` unless said)

| Name | Value | Holds |
|---|---|---|
| `SIGNED_OP_MAX_BYTES` | 12 288 | one `SignedOp` |
| `VFS_CHUNK_BYTES` | 262 144 (`ARTIFACT_CHUNK_BYTES`) | one blob chunk to or from the kernel |
| `VFS_P2P_CHUNK_OPS` | 16 | ops in one pair `ops` message |
| `VFS_GROUP_MSG_MAX_BYTES` | 16 384 | one group VFS message |
| `VFS_MAX_TIPS` | 64 | tips in one hello |
| `VFS_SIGN_MAX_OPS`, `VFS_SIGN_OPS_PER_S` | 64, 256 | the agent's signing request (`vfs-signing.md` §2) |
| `[vfs] max_append_ops`, `max_ops_per_pull`, `max_ops_per_minute`, `max_blob_bytes`, … | operator's, all required | kernel admission (`vfs-model.md` §7) |

## 8. Links

`LinkGrant::VfsEntry { volume, inode, link_id, browser_download }`: `vfs-outsiders.md` §8.

## 9. Tests V2 and V3 owe

Kernel: each row of the admission table refuses with its own refusal (control per row); a
non-member gets `NoSuchVolume` for every call and learns nothing else; a blob staged by one
member cannot be named by another's op (control: drop the uploader check → red); a read is
refused the chunk after the mode changes; after `Purge`, the purged name occurs nowhere in the
stored bytes of the log (control: skip redaction → red). Pair: two replicas that start from
different op sets converge to one tree after one hello each way, in both arrival orders. Group:
`vfs-group.md` §6. Routing: the written-out
list in `cid-routed-notifications.test.ts` is unchanged, and the two signing answers reach the
asking tab (control: add `VfsOpsSigned` to the set → the asking tab's request times out → red).
