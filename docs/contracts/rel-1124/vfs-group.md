# Contract: group volumes on the SDK's ordered broadcasts — FROZEN 2026-11-24 (round 2)

Parties: V8 (group volumes), lane SDK-ORDER (the SDK and agent side this depends on), V1 (the
reducer's ordered mode), V3 (the replica). This replaces the merge-by-stamp design: a
`group:<creator>:<mgid>` volume is an **ordered** volume. Names marked ◆ are **provided by lane
SDK-ORDER** and do not exist at SDK `9ccfb045`; §5 is exactly what V8 requires of that lane.

## 1. Order

- Every VFS message is one group broadcast. The relaying server assigns the broadcast its
  `seq` ◆ (a `u64` from 1, no gaps, one order across all senders).
- An op's **position** is `(seq, index)`: the `seq` of the broadcast that carried it and its
  index in that broadcast's `ops` array. Positions order lexicographically.
- A member applies an op only at its position: its own op when the send's acknowledgement
  brings the `seq` ◆, never at send time (until then the UI shows it as pending). A retried send
  reuses its message id ◆ and gets the same `seq`.
- Delivery is strictly in order ◆. A member never folds past a gap: it waits for the SDK to
  fetch it, or takes a state transfer (§4) when the range is trimmed.
- The stamp positions nothing here. `lamport` must still rise along the author's own `prev`
  chain; a `lamport` lower or higher than other authors' has no effect (`fixtures/reduce/17-*`).

## 2. Judging at a position (every member is a verifier)

There is no kernel: every member's replica runs the same checks on the same sequence and so
reaches the same tree. At each op's position, in this order; a failure skips the op for
everyone with the reason shown:

| Check | Skipped as |
|---|---|
| structure (`vfs-ops.md` §3) | `Invalid` |
| the author: a member's op must be carried by its author (`author == [1, sender]`, the sender being the cid the server stamped on the broadcast ◆); an outsider's op (`vfs-outsiders.md` §5) may be carried by any member | `NotAuthor` |
| the key: the first applied op of an author binds `SignedOp.key` to that author in this volume (for kind A outsiders and link guests the `Admit` / `Claim` binds it); a later op under another fingerprint | `KeyChanged` |
| the signature under that key | `BadSignature` |
| `op_id` not seen at an earlier position | `Duplicate` |
| `prev` equals the `op_hash` of the author's latest applied-or-skipped op at an earlier position (empty for the first) | `StalePrev` |
| `authorize` (`vfs-authorize.md` §4.5) with the member set, the group's owner and the tree as of this position | `Denied(…)` |
| the reducer's own rules (R4–R9) and `PEER_VOLUME_LIMITS` | `NoParent`, `Cycle`, `NotEmpty`, `Purged`, `Limit` |

- **Members and owner at a position** come from the group's membership and ownership events,
  which take a `seq` like any broadcast ◆. The member set at position *p* is the set after every
  such event with a smaller `seq`. The group's owner at *p* is the volume's **administrator**
  (`role.manage_files` in `authorize`); the first owner is the creator (`group_key.cid`).
- A member that cannot yet obtain the public key for a fingerprint asks for it (`key`) and does
  not fold past that op until it has it: a missing key is a wait, never a skip.
- The key bound in the log is also compared with the reader's own pin for that author
  (`vfs-signing.md` §3); a difference shows `KeyChanged` to that reader and changes no fold.
- In this release an account that replaces its identity key cannot write to a group volume it
  wrote to under the old key.

## 3. Messages

A VFS message is a group message whose body is `cbor-x` of
`{ t: "citadel-vfs/1", volume: string, sync: GroupVfs }` (`VFS_GROUP_ENVELOPE_TAG`), at most
`VFS_GROUP_MSG_MAX_BYTES = 16_384` bytes. A chat surface ignores a group message with this tag.
A group document's `CdocChatSync` payload travels under `t: "citadel-cdoc/1"`.

```ts
export type GroupVfs =
  | { readonly kind: 'ops'; readonly ops: readonly Uint8Array[] }        // SignedOps; position (seq, index)
  | { readonly kind: 'key'; readonly pk: Uint8Array }                    // an author's identity or invitation key
  | { readonly kind: 'have'; readonly sha256: readonly Uint8Array[] }
  | { readonly kind: 'fetch'; readonly sha256: Uint8Array }
  | { readonly kind: 'state-want'; readonly upto: bigint; readonly nonce: Uint8Array }
  | { readonly kind: 'state-offer'; readonly nonce: Uint8Array; readonly upto: bigint; readonly state_hash: Uint8Array };
```
Only `ops` changes the tree; the other kinds take a `seq` and are otherwise outside the fold.
Bytes: `have` and `fetch` as in `vfs-wire.md` §4; any holder with a P2P connection to the asker
serves it and the asker keeps the first that hashes right; with none, "No one who has this file
is online". Each member deletes its copy of a blob when it folds the `Purge`.

## 4. Catching up

| Situation | What happens |
|---|---|
| reconnect, or a gap | the SDK replays `(last, head]` from the member's cursor ◆ and fetches gaps ◆; V8 does nothing but fold |
| the range is older than the server keeps: the typed result "trimmed, earliest is N" ◆ | **state transfer** for positions below N, then replay from N |
| a member that joined at `seq` J (it cannot read broadcasts before J) | state transfer for positions below J |

**State transfer.** The asker broadcasts `state-want { upto, nonce }`. Each member that holds
the range answers `state-offer` with `state_hash`, then sends the state over a P2P connection
with the asker (the pair channel's `VfsSync` framing, kind `state`, chunked):
```
State      = { 1: v = 1, 2: volume, 3: upto uint,
               4: [ [seq, index, SignedOp bstr, att bstr] … ]     every op below `upto`, redacted bodies included
               5: [ [seq, kind (1 joined | 2 left | 3 owner), cid, att bstr] … ]   the membership and ownership events below `upto`
               6: [ VfsKey … ] }                                     the keys behind the ops' fingerprints
state_hash = SHA3-256(canonical CBOR of State)
```
The asker verifies every signature and every author's chain, folds the ops at the positions
given with §2's checks, and accepts the transfer only when the `state_hash` it computed equals
the one offered. Where two members offer different hashes for one `upto`, the volume is
`Unverified` and nothing is folded from either. `att` is **reserved** for a server attestation
over `(group, seq, message hash)`; whether it exists is evaluated by SDK-ORDER: it is the empty
byte string until then, and a reader ignores a non-empty one it cannot check.

## 5. What V8 requires of lane SDK-ORDER

1. Every broadcast of a group gets the group's next `seq: u64`, from 1, without gaps, assigned
   by the relaying server when it admits the broadcast; one order across all senders.
2. The sender's result carries the `seq` its broadcast got. A client-chosen message id makes a
   retried send idempotent: the same id gets the same `seq`, never a second one.
3. A received broadcast carries its `seq` and the sender's cid as the server stamped it.
4. A receiver is handed broadcasts strictly in `seq` order. A broadcast past a gap is held, the
   gap is fetched from the server, and nothing is delivered out of order or skipped silently.
5. On join and on reconnect a member presents the last `seq` it holds and is replayed
   `(last, head]` in order before any live broadcast.
6. A fetch or replay of a range the server no longer keeps answers a typed result
   "trimmed, earliest is N", never an empty or partial success.
7. Membership changes (join, leave, kick) and ownership transfer each take a `seq` and are
   delivered in order as events naming the cid, so the member set and the owner at any position
   are functions of the sequence. A member can read the `seq` at which it joined.
8. The counter and the broadcast are stored before the fan-out, and the counter never repeats
   or goes back, across a server restart included, on every backend that persists groups.
9. A group carries a body of at least `VFS_GROUP_MSG_MAX_BYTES` (16 384) bytes, and the cap
   that applies to a group can be read by its members.
10. Groups that exist before the upgrade are numbered too (from 1 at their first broadcast
    after it), so a chat that already exists can have a volume.
11. Agent wire: `GroupMessageNotification` and the send's answer gain `seq`; a fetch request and
    its answers (the broadcasts, or "trimmed") exist; membership and ownership notifications
    carry `seq`. Any response type this adds that arrives unsolicited joins
    `CID_ROUTED_NOTIFICATIONS` with its shape fixture, in the lane that adds it.
12. SDK-ORDER evaluates a server attestation over `(group, seq, message hash)` signed with the
    server's identity key, and reports its cost; if built, it is what fills `att`.
13. An ephemeral group (an app topic) is unaffected: it is never a volume.

What ordering does not give: the server chooses the order and can withhold; signatures and each
author's chain show a dropped or reordered op of one author. The same holds for kernel volumes.

## 6. Tests V8 owes

Three replicas given one sequence in different arrival patterns (in order; with a gap filled
late; one from a state transfer) reach one tree; `fixtures/reduce/12-*` and `17-*`; an op whose
carrier is not its author is skipped by all three (control: skip the check → one replica
diverges → red); two differing `state_hash` offers leave the volume `Unverified`; a member's
own op is not in its tree before its acknowledgement (control: apply at send → red on a
concurrent `Chmod`).
