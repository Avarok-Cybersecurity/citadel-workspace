# Contract: migration into volumes — FROZEN 2026-11-24

Parties: V1 (the pure functions, in `citadel-vfs::migrate`), V3 (client passes), V2 (kernel
passes), V5 (chat documents and files from now on use the same ids). Ids: `vfs-model.md` §2.

Every pass is a pure function `legacy value → Migration`, with no I/O and no clock:
```rust
pub struct OpDraft { pub kind: OpKind, pub target: InodeId, pub body: Body, pub at_ms: u64,
                     pub namespace: &'static str, pub key: String }
pub struct Migration { pub ops: Vec<OpDraft>, pub skipped: Vec<SkippedLegacy> }
pub struct SkippedLegacy { pub what: String, pub why: SkipReason }
pub enum SkipReason { BadName, NoMetadata, Inconsistent, BytesGone, SentRecord, UnsharedUpload }
```
The caller stamps each draft (`lamport`, `prev`), derives its `op_id` from `(namespace, key,
kind)` (`vfs-ops.md` §2), signs it and appends it. Drafts are emitted parents first, siblings in
ascending byte order of their names. Running a pass twice writes nothing new (`Duplicate`, or
`AlreadyExists { id: true }`); two devices or two members running it produce one tree (R4).
There is no flag day: an unmigrated source keeps working until its pass is recorded.

## 1. Legacy shapes (read from the code, not from memory)

| Source | Type | Where |
|---|---|---|
| Per-peer RE-VFS tree | `RevfsNode { name, type: 'file' \| 'directory', path, children?, fileState?, fileMetadata?, createdAt, updatedAt }`, `RevfsFileMetadata { fileId, fileName, fileSize, fileType, virtualDirectory, uploadedByCid, thumbnail? }`, `RevfsFileState = Hosted \| Remote \| Sent \| Received \| ServerStored` | `citadel-workspaces/src/types/revfs-types.ts`; OPFS, key `${mine}_${peer}` (`peerTreeKey`) |
| Server-scope RE-VFS tree | the same `RevfsNode`, key `server_${cid}` (`serverTreeKey`) | the same; one device only |
| Transfer records | file nodes under `/Sent Files` and `/Received Files` of the per-peer tree, written from `RecordEntry { fileName, fileSize, fileType, transferId, downloadPath? }` (`fileMetadata.fileId` is the transfer id) | `lib/revfs/transfer-records.ts`, `local-records.ts` |
| Direct-chat and scratchpad documents | `IndexRecord { doc_id, peer_cid, title: CdocChatTitleStamp \| null }`, `CdocChatTitleStamp { title, at, by }`; key `cdoc-chat:<account>:#index` | `lib/cdoc/chat/chat-local-db.ts`; the scratchpad is the entry whose `peer_cid` is the account |
| Node-chat documents | the node's list of chat document ids (`chat_documents_store`, pages under `citadel_workspace.chat_documents.<node>.index`); title = the `content` of the channel message of type `LiveDocument { document_id }` | kernel |
| Node-chat files | `AttachmentIndex { files: Map<attachment_id, AttachmentEntry { size_bytes, uploaders: Set<username>, messages: Set<message id>, uploaded_at_ms }> }`; name and type = the `FileShare { attachment_id, name, size_bytes, mime }` message | kernel (`kernel/chat_attachments.rs`, root `sys/chat-attachments`) |

## 2. Names

`legacy_name(raw, fallback)`: NFC-normalise `raw`; replace every `/` and every `Cc` code point
with `-`; cut to `NAME_MAX_BYTES` at a code-point boundary; if the result is empty, `.`, `..`
or holds an unassigned code point, use `fallback`. Names from a `RevfsNode` are only
NFC-normalised: one that is then not a valid `Name` is skipped with everything beneath it
(`BadName`). Two migrated names that collide by `fold_key` are both kept; R11 shows the later
one as `name (2)`.

## 3. Per-peer RE-VFS tree → `pair:<lo>:<hi>` (client, both members, each its own copy)

`migrate_peer_tree(me, peer, tree, received: &Map<transfer id, { sha256, len }>) -> Migration`

| Legacy node | Becomes |
|---|---|
| the root | nothing (the volume's root exists) |
| directory at `path`, other than the two record folders | `Create { Dir, id = (revfs-dir, path), parent = id of its parent path (the root for one level), name, pointee [0], mode DEFAULT_DIR_MODE, owner = me }`, `at_ms = createdAt` |
| file, `Remote` (the peer stores it for me) | `Create { File, id = (revfs-file, fileId), parent, name, pointee Revfs { owner: me, host: [1, peer], virtual_path: virtualDirectory, len: fileSize, mime: fileType }, mode DEFAULT_FILE_MODE, owner = me }`; `uploadedByCid` must be `me`, else `Inconsistent` |
| file, `Hosted` (I store it for the peer) | the same with `owner: peer, host: [1, me]` and entry `owner = peer`; `uploadedByCid` must be `peer`, else `Inconsistent` |
| file without `fileMetadata` | skipped, `NoMetadata` |
| `/Received Files/<name>`, state `Received` | if `received` has its transfer id: the seeded `Transfers` directory (`Create { Dir, id = (seed, "Transfers"), parent = root, name "Transfers", … }`), then `Create { File, id = (transfer, transfer id), parent = Transfers, name, pointee Standard { sha256, len, mime: fileType }, mode DEFAULT_FILE_MODE, owner = me }`; else skipped, `BytesGone` |
| `/Sent Files/<name>`, state `Sent` | skipped, `SentRecord`: the receiver's pass creates the entry, and both members then see it |

`received` is built by the caller from the files still on disk (it hashes them); the function
reads no file. Both members derive the same ids for the same directory path and the same
`fileId`, so the two imports are one tree. Existing objects keep their `virtual_path`; new
RE-VFS objects get `r/<32 hex>`. Nothing is re-uploaded.

## 4. Server-scope tree → `personal:<cid>` (client, the first device, then any other)

`migrate_server_tree(me, tree) -> Migration`: directories as in §3; a `ServerStored` file is
`Create { File, id = (revfs-file, fileId), …, pointee Revfs { owner: me, host: [0],
virtual_path: virtualDirectory, len, mime }, owner = me }`. Any other state is `Inconsistent`.
A second device whose local tree differs appends what the first did not have; equal ids merge.

## 5. Direct-chat and scratchpad documents → `/Documents` (client)

`migrate_chat_index(me, entries: &[IndexRecord]) -> Map<VolumeId, Migration>`

For each record: the volume is `device:<me>` when `peer_cid == me`, else the pair's. Per volume:
the seeded `Documents` directory, then `Create { File, id = (chat-doc, doc_id), parent =
Documents, name = legacy_name(title.title, doc_id) (or `doc_id` when `title` is null), pointee
LiveDoc { doc_id }, mode DEFAULT_FILE_MODE, owner = me }`, `at_ms = title.at` (0 when null).
From then on the entry's name **is** the document's title: a rename is a `Place`, and the title
stamp of `CdocChatSync` is no longer written.

## 6. Node chat → `node:<node_id>` (kernel, once per node, ops authored by `Server`)

`migrate_node_chat(node_id, documents: &[(doc_id, Option<TitleSource>)], files: &[(attachment_id, AttachmentEntry, Option<ShareSource>)]) -> Migration`

- Documents: the seeded `Documents`, then per document `Create { File, id = (chat-doc, doc_id),
  parent = Documents, name = legacy_name(message content, doc_id), pointee LiveDoc { doc_id },
  mode DEFAULT_FILE_MODE, owner = [1, cid of the message's sender] }`; with no such message the
  name is `doc_id` and the owner `[0]`.
- Files: the seeded `Chat files`, then per attachment that some message names
  (`messages` not empty): `Create { File, id = (chat-file, attachment_id), parent = Chat files,
  name = legacy_name(share.name, attachment_id), pointee Standard { sha256 = attachment_id,
  len = size_bytes, mime = share.mime }, mode DEFAULT_FILE_MODE, owner = [1, cid of the first of
  uploaders in byte order] }`, `at_ms = uploaded_at_ms`; the share is the `FileShare` message
  with the smallest id in `messages`. An attachment no message names is skipped
  (`UnsharedUpload`).
- Bytes do not move: the blob store of `node:<n>` **is** that node's chat attachment store. One
  store, two doors (`ChatAttachmentsRequest`, `VfsCall`); a blob is deleted only when no entry
  and no message names it.
- The pass is recorded under `citadel_workspace.vfs.<node_id>.migrated`; an unrecorded node is
  migrated before its volume's first `Pull` is answered.

## 7. Recording a client pass

A pass that ended with every op admitted (or already present) is recorded in the agent's
LocalDB under `vfs:<account>:<volume>#migrated` with the source's name and the counts of
`ops` and `skipped` by reason. Only then is the legacy OPFS tree renamed
(`tree.json` → `tree.migrated.json`); for a pair, only once the peer's hello shows it holds the
imported ops. The renamed files and the `#index` key are removed in the following release.
The File Manager shows the skipped counts once ("3 sent-file records were not moved: the files
are on <peer>'s side").

## 8. Tests V1, V2 and V3 owe

A corpus of real legacy shapes per source (`citadel-vfs/tests/migrate/`), each with its expected
drafts; twice-run and two-importer convergence (control: put the importer's cid into the id
derivation → the duplicate-entry assertion goes red); a `Hosted`/`Remote` pair of trees for the
same file reduces to one entry whose badge is green for the owner and golden for the host; a
`/Sent Files` record yields no entry on the sender's pass and one after the receiver's.
