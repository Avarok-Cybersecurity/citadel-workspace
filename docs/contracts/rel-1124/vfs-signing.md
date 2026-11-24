# Contract: author-signed VFS ops — FROZEN 2026-11-24

Parties: V9 (the `citadel-identity` addition, the agent request, kernel and client
verification, the key directory), V1 (`SignedOp` codec), V2, V3, V8 (they verify). Needs the
IDENTITY-UI lane's "attach": an account without an identity key cannot write to any volume.
Bytes of `Header`, `Body`, `SignedOp`: `vfs-ops.md` §2. Known answers: `fixtures/codec/sign-kat.json`.

## 1. What is signed, and with what

```
SignedOp = { 1: header bstr, 2: body bstr (empty when redacted), 3: key tstr(16), 4: sig bstr(3309) }
message  = "citadel-vfs-op-v1" ‖ 0x00 ‖ header          (citadel-identity's `domain_separated`)
sig      = ML-DSA-65.Sign(sk, message)                   pure ML-DSA, empty context, deterministic
key      = fingerprint(pk) = base32_lower_nopad(SHA3-256("citadel-identity-fp-v1" ‖ 0x00 ‖ pk)[..10])
```
- The parameter set is **ML-DSA-65** (FIPS 204), the one `citadel-identity` uses for everything:
  `PUBLIC_KEY_LEN = 1952`, `SIGNATURE_LEN = 3309` (`citadel-identity/src/keys.rs`).
- The signature covers the header bytes exactly as carried. A verifier checks the signature over
  those bytes first and only then decodes them. The header commits to the body (`body_hash`), the
  volume, `op_id`, the stamp, `prev` and `at_ms`, so an op cannot be replayed into another volume
  or twice into one, and the body can later be dropped without unsigning the op (`vfs-ops.md` §5).
- A member signs with the account's Citadel identity key (the key behind `AccountIdentity.id_fp`).
  The server signs ops it authors (`author = [0]`) with its identity key (`ServerKey`, the key
  behind `AccountIdentity.server_fp`). Device volumes are signed like any other.

Added to `citadel-identity` (V9; pure, like the rest of the crate):
```rust
pub const VFS_OP_DOMAIN: &[u8] = b"citadel-vfs-op-v1";
pub fn vfs_op_message(header: &[u8]) -> Vec<u8>;                                   // domain ‖ 0x00 ‖ header
impl Identity  { pub fn sign_vfs_op(&self, header: &[u8]) -> Vec<u8>; }
impl ServerKey { pub fn sign_vfs_op(&self, header: &[u8]) -> Vec<u8>; }
pub fn verify_vfs_op(pk: &MlDsa65Pk, header: &[u8], sig: &[u8]) -> Result<(), SignatureError>;
```
`citadel-vfs` depends on `citadel-identity` for `SignedOp::verify(&self, pk: &MlDsa65Pk)`.

## 2. The agent request (new wire types: the WASM stamp changes)

The identity key never leaves the agent. The page asks the agent to sign; the agent signs only
what it recognises as a VFS op by the signing account. Added to
`citadel-internal-service-types` (new module `vfs_sign.rs`; ts-rs bindings regenerated;
`TYPES_HASH` changes, so this rides the release's one `pkg-rebuilt` round):

```rust
InternalServiceRequest::VfsSignOps { request_id: Uuid, cid: u64, ops: Vec<VfsUnsignedOp> }
pub struct VfsUnsignedOp { pub header: Vec<u8>, pub body: Vec<u8> }

InternalServiceResponse::VfsOpsSigned(VfsOpsSigned)
pub struct VfsOpsSigned { pub cid: u64, pub request_id: Option<Uuid>, pub key: String, pub sigs: Vec<Vec<u8>> }

InternalServiceResponse::VfsSignFailure(VfsSignFailure)
pub struct VfsSignFailure { pub cid: u64, pub request_id: Option<Uuid>, pub index: u32,
                            pub reason: VfsSignRefusal, pub message: String }

#[serde(rename_all = "snake_case")]
pub enum VfsSignRefusal {
    NotConfigured, NoIdentity, Locked, NotAnIdentityAccount,   // as `IdentityRefusal`'s of the same names
    Malformed, NotAuthor, NotYourVolume, Reserved, TooLarge, RateLimited, #[serde(other)] Unknown,
}
```
`sigs[i]` signs `ops[i].header`; all or nothing; `index` names the first op refused. The answers
carry the request's id and are routed by it (`vfs-wire.md` §6). The request's `cid` joins the
request-to-cid match in `lib.rs` like `IdentityBinding`'s.

The agent, in this order, for every op (pure rule module `vfs_sign_rules`, with the table test):

| Check | Refusal |
|---|---|
| the agent has an identity store / an identity / it is unlocked | `NotConfigured` / `NoIdentity` / `Locked` |
| account `cid` is signed in on this agent and was registered with this identity | `NotAnIdentityAccount` |
| 1..=`VFS_SIGN_MAX_OPS = 64` ops; each `header + body <= SIGNED_OP_MAX_BYTES - 3400` | `TooLarge` |
| the header is canonical CBOR of `Header` with `v == 1`; the body is its kind's canonical map; `SHA3-256(body) == body_hash`; `vfs-ops.md` §3 holds as far as one op alone shows | `Malformed` |
| `kind` is 1..=8 | `Reserved` |
| `author == [1, cid]` | `NotAuthor` |
| the volume is the account's: `personal:<cid>` and `device:<cid>` name it; `pair:` has it as `lo` or `hi`; `group:` is a group this account is in on this agent; `node:` is well formed (its membership is the kernel's to judge) | `NotYourVolume` |
| at most `VFS_SIGN_OPS_PER_S = 256` ops a second on one connection (token bucket, burst the same) | `RateLimited` |

The unlock password is not asked per signature: a locked identity refuses `Locked`, the page
asks the person to unlock (`IdentityUnlock`) and sends the request again. Nothing else in the
agent signs with this domain.

## 3. Whose key: the directory

A reader needs, for each `author`, the public key behind `SignedOp.key`.

| Author | Where the key comes from | What is pinned |
|---|---|---|
| a member, any volume | `VfsCall::Keys` (`vfs-wire.md` §3) or a `key` sync message (§4, §5 there): the 1952-byte key, accepted only if `fingerprint(pk)` equals the `key` asked for | per reading account: `author → id_fp`, the first one seen |
| a member, cross-check | the member's published binding (`User.metadata["identity_binding"]`, `verify_binding`): its `id_fp` must equal the pinned one | — |
| the peer of a Pair volume | as above, and it must equal the fingerprint the agent pinned for that peer in the P2P key exchange (`GetPeerIdentity` → `PeerIdentityInfo.peer_fingerprint`) | the agent's pin |
| `Server` | the server key the account pinned (`AccountIdentity.server_fp`; the key itself from `ServerIdentity.pk` or `/.well-known/citadel`) | the account's pin |

- **Kernel.** It verifies a member's op against the key of that member's stored binding
  (`kernel::identity_binding`), refuses `UnknownKey` when `SignedOp.key` is not that key's
  fingerprint or the member has no binding, and records every key it admitted an op under, by
  fingerprint, so `Keys` can answer for ops of members who have since left or changed key.
- **Client.** It verifies **every** op it receives, from the server or a peer, before storing
  it. The pin is kept per reading account in the agent's LocalDB (`vfs-keys:<account>`).
- **A changed key.** An op by a pinned author under another fingerprint is not folded. The
  volume shows `KeyChanged { author, pinned_fp, presented_fp }` until the person accepts the new
  key (for a pair's peer: `AcceptPeerIdentityKey`, the existing flow) or refuses it.
- An account registered with a typed password (no `AccountIdentity`) has no key and no server
  pin: it reads volumes in the state `Unpinned` and cannot write.

## 4. Chains

`prev` is the `op_hash` of the same author's previous op in the same volume (empty for the
first), and `lamport` rises along it.
- Ordered volume: the kernel refuses an op whose `prev` is not the author's latest (`StalePrev`).
  A reader that pulls an op whose `prev` is not the hash of the previous op it holds by that
  author stops (`ChainBroken`).
- Merge volume: an op whose `prev` is not held is pending until it arrives (`vfs-ops.md` §4).

What the signatures establish: who wrote each op, that it was written for this volume, and that
none of an author's ops is missing between two that a reader holds. The order between authors in
an Ordered volume, and who is a member, are the authority's statements.

## 5. States a reader can be in (V3 implements, V4 shows; `vfs-ui.md` §6 has the words)

| State | When | Effect |
|---|---|---|
| `Verified` | every op held verifies and every chain is whole | normal |
| `Unpinned` | the reading account has no identity | read-only; a banner |
| `NeedsIdentity` | a write was asked and the agent answered `NoIdentity` or `NotAnIdentityAccount` | the write is not made; the person is sent to create or attach an identity |
| `Locked` | the agent answered `Locked` | the write waits for unlock; reading continues |
| `KeyChanged { .. }` | §3 | that author's new ops are held back; a full-page notice on the volume |
| `Unverified { seq_or_hash, reason }` (`BadSignature`, `UnknownKey`, `ChainBroken`, `BadRedaction`) | an op failed | Ordered: the replica stops at the last good `seq`, shows the tree as of it, read-only, full-page state with a retry. Merge: the op is dropped and never relayed, its sender is told (`refused`, `vfs-wire.md` §4), the volume carries on. |
| `UpdateNeeded` | `vfs-ops.md` R12 | read-only; "update Citadel" |

## 6. Tests V9 owes

`sign-kat.json`: the message bytes are recomputed by the contracts gate; the signature (ML-DSA is
deterministic) by the crate's test, which V9 records into the file. The agent rule table
(control per row; in particular: sign a header whose `author` is another account → `NotAuthor`,
control: skip the check → the other account's op is signed → red). A recording transport proves a
`Locked` agent signs nothing. Kernel: an op with a valid signature by a key that is not the
session account's is refused before `authorize` runs. Client: a pulled op with one flipped
signature bit puts the volume in `Unverified` (control: skip verification → the op folds → red).
A budget: one signature per op written, one verification per op read; batch verification runs in
the wasm worker, off the page's main thread; V1 records the measured cost per op on both targets.
