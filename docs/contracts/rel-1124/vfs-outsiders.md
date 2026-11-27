# Contract: outsiders (admission, links, claims) — FROZEN 2026-11-24 (round 2)

Parties: V7 (invite dialog, "Outside access", link landing), V1 (reducer and `authorize` rules),
V2 (kernel: transient boundary, outside calls, browser download), V3/V8 (members' devices serve
outsiders in pair and group volumes), V9 (invitation keys in the agent). Table of who may do
what: `vfs-authorize.md`. Bytes of `Admit`, `Dismiss`, `Claim`: `vfs-ops.md` §2.

An **outsider** is anyone who is not a member of the volume. An outsider can do something only
inside a subtree it was **admitted** to, and there only what each entry's outsider triple
(`mode & 0o007`) allows. Foreign Citadel identities (an identity with no account here) are not
in this release.

## 1. Kinds

| Kind | Who | Named in `Admit` as | Authors ops as | Proves itself |
|---|---|---|---|---|
| A | a member of the workspace who is not in this volume | `[1, cid, id_fp]` | `[1, cid]` | its session, and its identity key, whose fingerprint must be `id_fp` |
| C | a person with the agent and no identity, invited by link | `[2, link_id, link_pk, max_claims]` | `[2, link_id, key_fp]` | a `Claim`, then its invitation key |
| D | a person with only a browser, invited by link | the same link, with browser download on | nothing: it never writes | the link's token, on each request |

```
link_secret : 32 random bytes made by the inviter's client; never sent to any server
link key    : ML-DSA-65 KeyGen(HMAC-SHA3-256(link_secret, "citadel-vfs-link-v1"))        public half = link_pk
link_id     : SHA3-256("citadel-vfs-link-id-v1" ‖ 0x00 ‖ link_pk)[..16]
link URL    : <origin>/l/<token>#<base64url(link_secret)>      token = the secure link's own (the server holds its digest)
```
The token gates what the server does (quota, expiry, kind D); the secret, which stays in the URL
fragment, is what lets any verifier, with or without a server, check a claim.

## 2. Admission

`Admit { who, expires_ms, caps }` on entry `E`, by a member, writes `E.admissions[who]`
(`vfs-model.md` §4). It admits to `E` and everything beneath it, wherever those entries move
while they stay beneath `E`.

- **Who may admit or dismiss:** whoever may `Chmod` `E` (its owner; a volume administrator;
  either member of a pair). A link also needs `ShareSecureLinks` in a Personal or Node volume.
  An outsider never admits. A Device volume admits nobody (`NoOutsidersHere`).
- `who` of kind A must not be a member of the volume (`AlreadyMember`).
- `expires_ms` is required, non-zero, and at most 30 days after the op's `at_ms`
  (`SECURE_LINK_MAX_TTL_MS`) for a link; for kind A it may be 0 (until dismissed).
- `caps = [max_bytes, max_entries, max_ops_per_min]`, all required (`[0, 0, 0]` is a read-only
  admission whatever the bits say). The inviter chooses them in the dialog within the
  workspace's range (`[vfs] outsider_caps_max_*`); what an outsider stores counts against the
  **inviter's** quota.
- What the outsider may then do at each entry is that entry's outsider triple. The dialog sets
  the triple on `E` ("Can view" = `r-x` on a folder, `r--` on a file; "Can view and change"
  adds `w`) with a `Chmod` in the same batch. Widening = more bits or an `Admit` higher up;
  narrowing = fewer bits; ending = `Dismiss`.
- `Dismiss { who, lasts }` removes the admission. From the dismissal's position onward every op
  by that outsider is skipped (`NotAdmitted`); its earlier ops stay, attributed. In a Pair
  volume, which has no positions, `lasts` lists for each of the outsider's author principals
  the `op_hash` of its last op the dismisser accepts (empty for none): an op by that author
  that is not that op or one of its `prev` ancestors is skipped, whatever its stamp. In
  Ordered volumes `lasts` is empty.
- An admission whose `expires_ms` has passed admits nothing: the kernel judges by its clock; a
  member's device serving an outsider judges by its own clock when it takes the op in, and the
  fold judges by the op's `at_ms`.

## 3. Claim (kind C) and handover

`Claim { link_id, what }`, authored and signed by the invitation key (`author = [2, link_id,
key_fp]`, `SignedOp.key = key_fp`), targets the admitted entry.

| `what` | Meaning | Applied when |
|---|---|---|
| `[1, key_pk, link_sig]` | "this key is a guest of this link" | an admission for `link_id` is live on the target at this position; fewer than `max_claims` claims are applied for it; `fingerprint(key_pk) == key_fp`; `link_sig` is an ML-DSA-65 signature by `link_pk` over `"citadel-vfs-claim-v1" ‖ 0x00 ‖ lp(volume) ‖ target ‖ key_pk`. Else skipped: `NotAdmitted`, `ClaimsExhausted`, `BadClaim`. |
| `[2, cid, id_fp]` | handover: "my access passes to this identity" | the author has an applied claim and is not dismissed. The admission gains `[1, cid, id_fp]` with the same expiry and caps, and the author's key is refused from this position on. Offered to the person as "Keep this access: create your identity". |

The invitation key is made by the outsider's agent for this one invitation, sealed in its vault,
and survives restarts. The kernel additionally requires the session to have presented the
link's token (§6). `max_claims` is 1..=`MAX_BOOKING_GUESTS` (50).

## 4. What an outsider may and may not do (the accepted answers)

- Read and list where the triple has `r` (and `x` on every folder from the admitted entry down;
  nothing above it is consulted or shown). Never an RE-VFS file (`RevfsOwnerOnly`): its owner
  converts it to a shared file first.
- `Create`, `Place` (both parents inside one admission), `SetPointee` and `Remove` where the
  triple has `w`, within the caps (`AdmissionCap(Bytes | Entries | Rate)`).
- **Never owns:** an entry an outsider creates is owned by the member who admitted it
  (`Create.owner` must be the admission's `by`, else `OwnerNotAdmitter`); the outsider is its
  `created.by`.
- **Never** `Chmod`, `Chown`, `Restore`, `Purge`, `Admit`, `Dismiss` (`OutsiderNot`); never
  writes an RE-VFS pointee; never re-shares.
- **Never runs an app:** `x` is traverse only. `/Applications`, app homes (`/.apps`) and
  "Open with" are not offered; files open in the built-in viewers.
- **Sees** the admitted subtree's entries that are not removed, and the display names of the
  authors of those entries. Not the Recycle Bin, not ancestors or siblings of the admitted
  entry, not the member list.
- Storage quota and abuse: the caps; a link's use is counted in the same pool as the member's
  other secure links.

## 5. How an outsider is served

An outsider never holds the volume's log (it would show everything). It is served a **view**:
the admitted subtree as entries (the `Entry` maps of `vfs-wire.md` §3.3, removed ones left
out), and from then on the ops whose target lies in it. It verifies each op's signature and
cannot check chains or positions: for the tree's shape it relies on whoever serves it.

| Volume | Kinds A and C are served by | Kind D |
|---|---|---|
| Personal, Node | the kernel (`VfsCall::OutsideView`, `OutsideAppend`, `ReadChunk`, `UploadChunk`, each naming the admitted entry) | the kernel's download route (§7) |
| Pair, Group | any member's device that is online (`VfsSync` kinds `outside-hello`, `outside-view`, `outside-ops`, over a P2P connection with the outsider); with none online the outsider is told "No one who can share this is online" | not possible: the dialog offers "Copy to My files and share", saying the server will then hold the file |

A member's device takes an outsider's op in only after running `authorize` for it; in a Pair it
then relays it as any op, in a Group it broadcasts it and the op takes the position of that
broadcast (`vfs-group.md` §2: the carrier is the relaying member, the author the outsider).
Every admission, claim, handover, dismissal and (kind D) download count and time is listed on
the entry's Properties → "Outside access" and in the workspace's audit log.

## 6. The kernel's transient-session boundary

The workspace server accepts transient sessions (`allow_transient_connections`, with the
SDK-TRANSIENT builder option). A transient session is in one of two states:

| State | Served | Everything else |
|---|---|---|
| **unbound** (as connected) | `ServerIdentityChallenge`; `VfsCall::OutsideClaim { token, claim }` (a `Claim` op, or for a returning guest a signature by its already-claimed invitation key over the server's nonce) with a token that resolves to a live `LinkGrant::VfsEntry` | refused **before any handler runs** with `WorkspaceProtocolResponse::TransientRefused(TransientRefusal::NotServed)` |
| **bound** to one admission (after an accepted `OutsideClaim`) | the four outside calls of §5, for that admitted entry only | the same refusal |

`TransientRefusal = NotServed | BadToken | RateLimited`. `OutsideClaim` is rate-limited per
address (`[vfs] transient_claims_per_minute`, required). The gate is one function at the top of
the command processor, tested with every request variant of the protocol (control: let one
other variant through → red).

## 7. Kind D: browser download

Off unless an administrator turns on the workspace setting `vfs_browser_links` (it is created
off) and the inviter ticks "Anyone with the link can download" (`browser_download`). Then
`GET <origin>/l/<token>` with nothing installed shows a page with the file's name, size, who
shared it, **Download**, and "Get Citadel to do more". The server checks the token's digest,
the link's life, and `r` (and `x` above it, from the admitted entry) in the outsider triple at
the time of each request; serves `Standard` files only, a folder as a zip of the files that
check reaches; never an RE-VFS file; counts each download. Personal and Node volumes only.

## 8. `LinkGrant::VfsEntry`

```rust
// citadel-workspace-types/src/secure_links.rs
LinkGrant::VfsEntry {
    volume: String,            // the volume id
    inode: String,             // 32 hex: the admitted entry
    link_id: String,           // 32 hex (§1)
    browser_download: bool,    // kind D allowed; refused unless `vfs_browser_links` is on and the volume is Personal or Node
}
```
Made with the existing `SecureLinksRequest::Create` (so `ShareSecureLinks`, the per-member
quota and the 30-day ceiling apply unchanged); `target` is the File Manager link of the entry;
a link carries exactly one `VfsEntry` grant and no other grant. For a Personal or Node volume
the kernel requires an applied `Admit` of that `link_id` on that entry by the creator. For a
Pair or Group volume the server cannot see the tree (as with `GroupSnapshot`): it keeps the
link for quota, expiry and the landing page, and members' devices judge everything else.
Deleting or expiring the link ends kind D at once; the inviter's client also sends `Dismiss`.

## 9. Tests V7, V1 and V2 owe

The outsider rows of `fixtures/authorize/cases.json`; a claim past `max_claims` is skipped; a
dismissed key's later op is skipped in an Ordered volume by position and in a Pair by `lasts`
(control: ignore `lasts` → a late-arriving op with an old stamp applies → red); an outsider's
`Create` is owned by its admitter; the transient gate's table (control above); kind D refuses
an RE-VFS file and a link whose workspace setting is off; the view served to an outsider holds
no entry outside the admitted subtree and no removed entry (control: serve the log → red).
