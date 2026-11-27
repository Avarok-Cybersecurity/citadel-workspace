# Contract: VFS ops, their bytes and the reducer — FROZEN 2026-11-24, revised round 2

Parties: V1 (codec, reducer), V2, V3, V8 (they carry and fold ops), V9 (signature).
Model: `vfs-model.md`. Permission table: `vfs-authorize.md`. Fixtures: `fixtures/reduce/`,
`fixtures/codec/`.

## 1. The ops

| # | Kind | Body | Effect |
|---|---|---|---|
| 1 | `Create` | `kind, parent, name, pointee, mode, owner` | a new entry `target` |
| 2 | `Place` | `parent, name` | move and/or rename, one atomic write of `place` |
| 3 | `SetPointee` | `pointee` | replace a file's bytes reference |
| 4 | `Remove` | none | set `removal` (the Recycle Bin) |
| 5 | `Restore` | none | clear `removal` |
| 6 | `Purge` | none | "Delete Forever": the entry leaves the state for good |
| 7 | `Chmod` | `mode` | write `mode` |
| 8 | `Chown` | `owner` | write `owner` |
| 9 | `Admit` | `who, expires_ms, caps` | admit an outsider to `target` and what is beneath it |
| 10 | `Dismiss` | `who, lasts` | end that admission |
| 11 | `Claim` | `link_id, what` | a link's guest binds its invitation key, or hands its access to an identity |

Every op names one `target` entry and carries a stamp `(lamport, author, op_id)`. Kinds 9..=11:
`vfs-outsiders.md`.

## 2. Canonical bytes

RFC 8949 **core deterministic** CBOR, as `batch-1116/sw-wire.md` §1: shortest integer heads,
definite lengths, map keys sorted by their encoded bytes, no duplicate keys, no floats, no tags,
no `null` (an absent value is an empty byte string, an empty array or 0, as stated per field).
A decoder refuses anything else, an unknown key, and a missing key. All maps here use **integer
keys**, so sorted order is ascending key order. `scripts/lib/contracts/cbor.mjs` is the reference
encoder and decoder; the P2P envelope that carries these bytes stays `cbor-x` (`vfs-wire.md`).

```
Header = { 1: v = 1,
           2: volume      tstr                    the volume id (vfs-model §1)
           3: op_id       bstr(16)
           4: author      Principal               [0] | [1, cid] | [2, link_id bstr(16), key_fp tstr(16)]
           5: lamport     uint (1 ..= 2^63 - 1)
           6: prev        bstr(32) | bstr(0)      op_hash of this author's previous op in this volume; empty = none
           7: kind        uint (1 ..= 11)
           8: target      bstr(16)                InodeId
           9: body_hash   bstr(32)                SHA3-256(body bytes)
          10: at_ms       uint }                  the author's wall clock; never orders anything

Body (by kind; `{}` is the empty map, one byte 0xa0):
  Create     { 1: kind (1 Dir | 2 File), 2: parent bstr(16), 3: name tstr, 4: pointee, 5: mode uint, 6: owner Principal }
  Place      { 1: parent bstr(16), 2: name tstr }
  SetPointee { 1: pointee }
  Remove, Restore, Purge   {}
  Chmod      { 1: mode uint }
  Chown      { 1: owner Principal }
  Admit      { 1: who Admitted, 2: expires_ms uint (0 = until dismissed), 3: caps [max_bytes uint, max_entries uint, max_ops_per_min uint] }
  Dismiss    { 1: who ([1, cid] | [2, link_id bstr(16)]), 2: lasts [ [author Principal, op_hash bstr(32) | bstr(0)] … ] }
  Claim      { 1: link_id bstr(16), 2: what ([1, key_pk bstr(1952), link_sig bstr(3309)] | [2, cid uint, id_fp tstr(16)]) }

Admitted   = [1, cid uint, id_fp tstr(16)] | [2, link_id bstr(16), link_pk bstr(1952), max_claims uint (1..=50)]

Pointee    = [0] | [1, sha256 bstr(32), len uint, mime tstr]
           | [2, owner uint, host Principal, virtual_path tstr, len uint, mime tstr] | [3, doc_id tstr]

SignedOp   = { 1: header bstr, 2: body bstr, 3: key tstr(16), 4: sig bstr(3309) }            (vfs-signing.md)

op_hash    = SHA3-256(header bytes)
```
- `op_id`: 16 random bytes; for a migration op, the first 16 bytes of
  `SHA3-256("citadel-vfs-migrate-v1" ‖ 0x00 ‖ lp(volume) ‖ author bytes ‖ lp(namespace) ‖ lp(key) ‖ u8(kind))`,
  so one importer running twice writes the same op.
- A `SignedOp` is at most `SIGNED_OP_MAX_BYTES = 12_288` bytes (a `Claim` carries a key and two signatures).
- `body` is the empty byte string only for a **redacted** op (§5); a real body is never empty.
- `fixtures/codec/` holds headers, bodies and their hashes as `cbor_hex` + `model`.

## 3. Structural validity (checked by every party before anything else)

An op that fails any of these is `Invalid` and is never stored or folded:
`v == 1`; `volume` is the volume it arrived for; the body decodes as its kind's map and hashes to
`body_hash`; `name` is a valid `Name`; `mode <= 0o777`; `Create.kind` is 1 or 2; a `Dir` is
created with pointee `[0]` and a `File` with any other; `SetPointee` never carries `[0]`; field
bounds of `vfs-model.md` §4 and §7; `target` and `parent` are not equal; `target` is not the
root; `lamport` is greater than the lamport of the op `prev` names; a `Claim` is authored by a
`LinkGuest` of its own `link_id`, and no other kind in a Device volume names an outsider.

## 4. The reducer

`reduce(volume, ops) -> Tree` is a pure, deterministic fold of valid ops, each at its
**position**:

**R1 Order.** In an Ordered volume the position is the op's place in the sequence: `seq` in a
Personal or Node volume, `(seq, index)` in a Group volume (`vfs-group.md` §1). In a Merge volume
(Pair, Device) the position is the stamp: `lamport`, then `author` (canonical bytes), then
`op_id` (bytes), and arrival order never matters: any permutation of one set reduces to one
tree. Wherever a rule below says "greater stamp" or "last writer", read "later position".
`lamport` therefore orders ops only in Merge volumes. In an Ordered volume it is carried, must
rise along its author's own chain, and decides nothing (the kernel additionally refuses a stale
one, so there stamp order and `seq` order agree; a group's relay does not, and there a stamp
has no effect).

**R2 Same `op_id`.** Two ops with one `op_id` and one `op_hash` are one op. With different
hashes: in a Merge volume the one whose `op_hash` is smaller bytewise is kept and the other
dropped; in an Ordered volume the one at the earlier position is kept (`Duplicate`).

**R3 Registers.** `place`, `pointee`, `owner`, `mode`, `removal` and each admission are
last-writer-wins: the op with the greatest stamp wins. `Remove` and `Restore` write the one
`removal` register.

**R4 Create.** A `Create` for an id that already exists does not replace the entry: `kind` and
`created` stay as the earliest-stamped `Create` set them, and its `place`, `pointee`, `owner`
and `mode` take part in R3 like any other write. (Two importers of one derived id merge.) A
later `Create` whose `kind` differs from the entry's is skipped (`Duplicate`).

**R5 Parents.** A `Create` or `Place` whose `parent` does not exist at its position, is not a
`Dir`, or is purged, is skipped (`NoParent`).

**R6 Cycles.** A `Place` whose `parent` is `target` or a descendant of `target` at its position
is skipped (`Cycle`). The result is always a tree.

**R7 Depth and size (volumes without a kernel: Pair, Device, Group).** A `Create` or `Place` that would put an entry deeper
than `max_depth`, or a `Create` past `max_entries` or `max_entries_per_dir`
(`PEER_VOLUME_LIMITS`), is skipped (`Limit`). The kernel refuses these at admission instead.

**R8 Removed entries.** Any op on an entry in the `removed` state is applied; the entry stays
removed until a `Restore` wins `removal` on it and on every removed ancestor. `Remove` of a
directory sets `removal` on the directory only: its descendants are removed by ancestry and come
back with it.

**R9 Purge.** `Purge` applies only if, at its position, `target` exists and has **no child that
is not itself purged**; otherwise it is skipped (`NotEmpty`). Applied, it is terminal: the entry
leaves the state, a marker holding only its id remains, and every op on that id with a greater
stamp is skipped (`Purged`); a `Create` or `Place` naming it as `parent` is skipped by R5. Deleting a
folder for good is therefore one `Purge` per descendant, deepest first, then the folder.

**R10 Authorization in the fold (volumes without a kernel: Pair, Device, Group).** Each op is
checked with `authorize` (`vfs-authorize.md`) against the tree at its position; a refused op is
skipped (`Denied`) by every replica alike. In a Group volume the member set and the
administrator are those of that position (`vfs-group.md` §2). Personal and Node replicas do not
re-run `authorize` for members' ops when folding: the kernel ran it before the op entered the
log. An op authored by `Server` is the exception:
every replica of every volume checks it with `authorize` and skips it if refused, so a server
writes only the kinds the table gives it.

**R11 Names shown.** Stored names are never changed by the reducer. Among the entries of one
directory that are not in the `removed` state, those with equal `fold_key` are ranked by the
stamp that won their `place`, ascending. The first is shown under its stored name. The k-th
(k >= 2) is shown as `stem (n)ext`, where `ext` starts at the last `.` of the name if that `.`
is not its first character (else `ext` is empty), and `n` is the smallest integer >= 2 whose
candidate's `fold_key` equals no stored or already-assigned shown name in that directory. Paths
(`sdk::fs`, deep links) resolve by **shown** name. `fixtures/reduce/07-*.json`.

**R12 Unknown kinds.** A replica that meets a header with `v != 1` or a `kind` it does not know
stops folding that volume and reports `UpdateNeeded`; it never guesses.

`Tree` exposes, for every entry: the fields of `vfs-model.md` §4, the stamp that won each
register, the shown name, the derived state, and the list of skipped ops with their reason
(`Skipped { op_id, reason }`, reasons exactly: `NoParent`, `Cycle`, `Limit`, `NotEmpty`,
`Purged`, `Denied(Denied)`, `Duplicate`, and in a Group volume also `Invalid`, `NotAuthor`,
`KeyChanged`, `BadSignature`, `StalePrev`).

### Personal and Node volumes: what admission adds (kernel, V2)

The kernel admits a batch atomically, in the order given, and refuses the whole batch with the
first failure (`VfsRefusal`, `vfs-wire.md` §3):

| Check | Refusal |
|---|---|
| signature and key (`vfs-signing.md`) | `BadSignature`, `UnknownKey` |
| `author` is the session's own account | `NotAuthor` |
| §3 structure | `Invalid` |
| `prev` equals the `op_hash` of the author's latest admitted op in this volume (empty if none) | `StalePrev { expected }` |
| `lamport` is greater than the volume's greatest admitted lamport | `StaleStamp { latest }` |
| `at_ms` within `at_skew_ms` of the kernel's clock | `Skew` |
| `op_id` unseen | `Duplicate` (the caller treats it as done) |
| `authorize` against the kernel's own tree and member list | `Denied(Denied)` |
| R5, R6, R9 against the kernel's tree | `NoParent`, `Cycle`, `NotEmpty`, `Purged` |
| `Create` of an existing id | `AlreadyExists { id: true }` (a derived id: the caller treats it as done) |
| a `Create`/`Place` whose name collides with a live sibling | `AlreadyExists { id: false }` |
| limits (`[vfs]`) | `Limit(which)` |
| a `Standard` pointee's blob (`vfs-wire.md` §3.2) | `BlobMissing`, `BlobMismatch` |

So in a Personal or Node volume stamp order equals `seq` order, no two live siblings ever collide, and
every replica folds the same sequence. A client applies its own op at once and removes it if the
batch is refused.

### Pair volumes: what ingestion adds (client, V3)

A replica stores an op only if its signature verifies (`vfs-signing.md`), it is structurally
valid, and its author is one of the two accounts and it came over that pair's channel or was
made here, or its author is an outsider one of them admitted (`vfs-outsiders.md` §5). An op
whose `prev` it does not hold is kept **pending**, not folded, until the gap is filled. Two ops
by one author with one `prev` (one account on two devices) are both kept and both folded.

### Group volumes: what each position adds (every member, V8)

`vfs-group.md` §2: the same checks the kernel makes, made by every member at the op's position,
with a skip where the kernel would refuse.

## 5. Purge, storage and redaction

When a `Purge` is folded, the holder of the log deletes what the entry pointed at and redacts
the entry's history:
1. **Bytes.** `Standard`: the blob is deleted when no remaining entry of the volume names its
   `sha256`. `Revfs`: the host deletes the ciphertext (`DeleteVirtualFile`). `LiveDoc`: the
   document's update log is deleted.
2. **Metadata.** Every stored `SignedOp` whose `target` is the purged id has its `body` replaced
   by the empty byte string. Header, key and signature stay, so each author's `prev` chain still verifies and
   the name and pointer are gone from storage.

A `SignedOp` with an empty body is valid **only** if the same log holds an applied `Purge` of its
`target`; any other is `Invalid`. A redacted op folds as "skipped: `Purged`". A reader that
already holds the body keeps nothing of it once it folds the `Purge`.

## 6. Tests V1 owes (each with its control)

The corpus `fixtures/reduce/` on both targets, byte-identical trees; a property test that any
permutation of a Pair op set reduces to one tree (control: fold in arrival order → red); cycle,
purge and name-collision properties; the codec fixtures round-trip through the Rust encoder and
`cbor.mjs` to the same bytes (control: emit map keys unsorted → red); the redaction rule
(control: accept an empty body without its `Purge` → red).
