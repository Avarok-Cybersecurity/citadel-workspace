# REL-1124 contracts: one virtual filesystem — FROZEN 2026-11-24

What the VFS lanes build against, so they can work at once without inventing a name, a number,
a byte layout or a rule. Format and tone follow `../batch-1116/`.

| Contract | Files | Built by |
|---|---|---|
| Model: volumes, ids, entries, names, modes, limits, derived places, File Manager root | `vfs-model.md`, `fixtures/names/`, `fixtures/codec/inode-kat.json` | V1 (crate), V2, V3, V4 |
| Ops, canonical bytes, the reducer, admission, redaction | `vfs-ops.md`, `fixtures/reduce/`, `fixtures/codec/` | V1 (codec, reducer), V2 (admission), V3, V8 (ingestion) |
| `authorize`: every op × actor class × volume kind; reading; workspace permissions | `vfs-authorize.md`, `fixtures/authorize/` | V1 (function), V2, V3, V4, V6, V8 |
| Signed ops: layout, domain, ML-DSA-65, the agent request, key directory, reader states | `vfs-signing.md`, `fixtures/codec/sign-kat.json` | V9; V1 (codec); V2, V3, V8 (verify) |
| Wire: kernel protocol, blob binding, pair and group sync, routing, caps, the reserved link grant | `vfs-wire.md`, `fixtures/routing/` | V2 (kernel), V3 (pair), V8 (group), V5 |
| Apps ABI group 19 `fs`: ops, capabilities, manifest, retirements, inspector rule | `fs-abi.md` | V6; V2 (`via`) |
| `sdk::fs` (every `std::fs` item) and `sdk::vfs` | `sdk-fs-surface.md` | V6 |
| File Manager: deep links, "Navigate to Folder", badges, behaviour checklist, words | `vfs-ui.md` | V4, V5 |
| Migration of every legacy source, as pure functions | `vfs-migration.md` | V1 (functions), V2 (kernel passes), V3 (client passes) |

## Numbers and names reserved here

| What | Value |
|---|---|
| Apps ABI group | **19 = `Fs`**, import `fs` (17 stays reserved for identity) |
| Apps ABI minor | `ABI_MINOR_FS = 2`; `ABI_MINOR = 2` |
| `Fs` op numbers | 1..=31 (`fs-abi.md` §3) |
| Capabilities (appended, in this order) | `fs.app`, `fs.read`, `fs.write`, `fs.volume.read`, `fs.volume.write` |
| Retired | group `Files = 6`; `Storage` ops 6..=11; capabilities `files.read`, `files.write`, `storage.files`, `storage.blob` (numbers never reused) |
| `Permission` | `ManageFiles`, appended last (`ALL_VARIANTS` becomes 53 long) |
| VFS op kinds | 1 `Create`, 2 `Place`, 3 `SetPointee`, 4 `Remove`, 5 `Restore`, 6 `Purge`, 7 `Chmod`, 8 `Chown`, 9 `Admit`, 10 `Dismiss`, 11 `Claim` (9..=11 reserved) |
| Header and body keys, `Pointee` and `Principal` tags | `vfs-ops.md` §2, `vfs-model.md` §3, §4 |
| Signature domain | `citadel-vfs-op-v1` |
| Derivation domains | `citadel-vfs-inode-v1`, `citadel-vfs-migrate-v1` |
| Agent wire | request `VfsSignOps`; responses `VfsOpsSigned`, `VfsSignFailure` (the WASM stamp changes) |
| Workspace protocol | `WorkspaceProtocolRequest::Vfs`, `WorkspaceProtocolResponse::Vfs`; `AppsRequest::SetFsConsentForMe` |
| P2P | `P2PCommandType.VfsSync`; group envelope tags `citadel-vfs/1`, `citadel-cdoc/1` |
| Kernel config | section `[vfs]`; workspace setting `vfs_retention_days` |
| Crate | `citadel-vfs`, in the agent repository beside `citadel-identity` |
| Reserved, not added | `LinkGrant::VfsEntry`; `Principal::Outsider`'s meaning; `/Shared with me`'s content |

## Who owns which implementation

| Lane | Owns |
|---|---|
| V1 | `citadel-vfs`: model, name rules and tables, codec, reducer, `authorize`, derived views, `migrate`; the corpus on native and wasm; extending `scripts/check-batch-contracts.mjs` (or a sibling gate) to these fixtures |
| V2 | kernel: `[vfs]`, the log store, admission, blob staging and reads, redaction, retention purge, `Permission::ManageFiles`, kernel migration passes, the `via` check |
| V3 | client: the wasm binding, volume replicas, pair sync, key pins, client migration passes; the TS `revfs` merge retires |
| V4 | File Manager on volumes (`vfs-ui.md` §1, §3–§6) |
| V5 | chat documents and files as entries; "Navigate to Folder" (`vfs-ui.md` §2) |
| V6 | `citadel-app-sdk-types` group 19, the guest SDK (`fs`, `vfs`, `task`), the ABI inspector rule, the host port, manifest fields and their TS mirror |
| V8 | group volumes (`vfs-wire.md` §5) |
| V9 | `citadel-identity` additions, the agent's `VfsSignOps`, kernel and client verification, the key directory |
| V7 | held: everything outsider-facing |

## Decided by the owner (2026-11-24)

- Every app writes through the VFS; there is one way for an app to store a file (D1).
- Peer groups get volumes in this release, with no workspace server deciding (D3).
- Outsiders are a class of their own with read/write/execute per tree node (D4): the third
  triple of every mode.
- The Recycle Bin shows every removed entry of a volume to all its members (D5).
- Retention before automatic purge: 30 days, set by an administrator (D6).
- The host of an RE-VFS file may delete it only to the bin; the owner is told; the host purges
  only once retention has passed or the owner agreed (D7).
- Tree ops are author-signed with ML-DSA now (D8).
- People with no account: read-only (D9; how is pending).
- `ManageFiles` is a new permission (D10).
- Names are case-insensitive and case-preserving, and the File Manager behaves as a desktop
  file browser does (D11).
- A document made in a chat is a file where that chat stores things; `sdk::fs` maps every
  `std::fs` item for Standard and RE-VFS; `/Applications` holds the apps; a golden lock for the
  host and a green mark for the owner (the request itself).

## Frozen by V0 as engineering choices (each can be reopened by the orchestrator)

1. `citadel-vfs` lives in the agent repository (the agent must decode an op to sign it, and the
   agent cannot depend on the parent).
2. A signed op is a **header** (signed) that commits to a **body** by hash, so Delete Forever
   can erase names and pointers from storage without breaking any author's chain.
3. `Purge` removes exactly one entry and is skipped while that entry has unpurged children;
   deleting a folder for good is one `Purge` per descendant.
4. One fold order everywhere: the stamp `(lamport, author, op_id)`. Ordered volumes make it
   equal the log order by refusing a stale lamport.
5. **Group volumes are Merge volumes.** The SDK's group relay gives no sequence number and a
   bounded per-member mailbox, so no total order is taken from it; every replica runs
   `authorize` in the fold.
6. A message is signed over `domain ‖ 0x00 ‖ header`, as everything in `citadel-identity` is.
7. Hashes: SHA3-256 for ids and op hashes; SHA-256 only for content ids. Canonical CBOR with
   integer keys and no `null`, so `scripts/lib/contracts/cbor.mjs` reads every fixture.
8. Names: Unicode 17.0.0, NFC required (refused, not repaired), unassigned code points refused,
   simple case folding (statuses C and S).
9. Limits of Merge volumes are constants every replica shares; limits of Ordered volumes are
   the operator's `[vfs]` keys, all required.
10. `sdk::fs` returns `fs::Io<T>`; `Pending<T>` and `Io<T>` become futures and the SDK gains
    `task::spawn`. `File` has async methods in place of `Read`/`Write`/`Seek`.
11. Every `fs` call is performed by the page host as the member's own signed op; for kernel
    volumes it carries `via`, and the kernel checks the install's grant before the member's
    rights.
12. The inspector refuses the `files` import; the retired `storage` ops are refused when called
    (they share an import with KV and cannot be seen statically). A manifest declaring a
    retired capability is refused.
13. Received transfers land in one shared folder, `/Transfers`; a sender's record is not
    migrated (it has no bytes and no hash), the receiver's is.
14. A document's title is its entry's name from migration on.
15. `Restore` only clears `removal`; "restore to the root when the folder is gone" is a client
    composite, and a taken name is shown as `name (2)` by the general rule.
16. Retention in pair, group and device volumes is the constant `PEER_RETENTION_MS` and nothing
    purges there automatically.
17. No member is added to `CID_ROUTED_NOTIFICATIONS`: every VFS carrier is already routed by
    `cid`, and the two signing answers are routed by `request_id`.
18. A `LiveDoc` in a Personal volume is refused in this release (no document log is addressed
    by a personal volume yet).
19. The outsiders row of Properties is not shown, and `chmod` of the third triple is accepted
    and has no effect, until OUTSIDERS-1124 is answered.

## Pending OUTSIDERS-1124 (frozen as "refuse")

Who an outsider is and how they prove it; `Admit`, `Dismiss`, `Claim` (their bytes are frozen,
every actor is refused `OutsidersPending`); `Principal::Outsider`'s contents; `/Shared with
me`; `LinkGrant::VfsEntry`; `vfs::admit` / `vfs::dismiss`; `ShareSecureLinks` in the VFS;
whether an outsider can own, re-share or run anything.

## Fixtures

| Directory | Holds | Format |
|---|---|---|
| `fixtures/reduce/` | 18 op sets with the expected tree, one reducer rule each (named in `rule`) | ops and entries as JSON models; `"root"` stands for the volume's root id (also given as `root`); a principal is `[0]` or `[1, cid]`; modes are decimal; the reducer is given verified ops, so no signature and no `prev` appear |
| `fixtures/authorize/cases.json` | 54 cases over five trees, each naming its cell of `vfs-authorize.md` | `expect` is `"ok"` or the `Denied` value |
| `fixtures/codec/` | headers and bodies as `cbor_hex` + `model`, their hashes, the bytes a signature covers, derived ids, three refusals | the notation of `batch-1116/sw-wire.md` §1 |
| `fixtures/names/cases.json` | valid and invalid names; pairs that collide and pairs that do not | UTF-8 JSON strings |
| `fixtures/routing/shapes.json` | the two signing answers' shapes | as `SHAPES` in `cid-routed-notifications.test.ts` |

The expected trees and the authorize answers were worked out by hand from the rules; the hex
was computed with `scripts/lib/contracts/cbor.mjs` and Node's SHA3-256 and round-trips through
the reference decoder. V1 wires them into the contracts gate. Changing a frozen contract:
change the file, change the fixtures, and tell every lane in its "built by" column in the same
message as the commit.
