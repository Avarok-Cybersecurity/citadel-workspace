# REL-1124 contracts: one virtual filesystem — FROZEN 2026-11-24, revised for the owner's second round

What the VFS lanes build against, so they can work at once without inventing a name, a number,
a byte layout or a rule. Format and tone follow `../batch-1116/`.

| Contract | Files | Built by |
|---|---|---|
| Model: volumes, ids, entries, names, modes, limits, derived places, File Manager root | `vfs-model.md`, `fixtures/names/`, `fixtures/codec/inode-kat.json` | V1 (crate), V2, V3, V4 |
| Ops, canonical bytes, the reducer, admission, redaction | `vfs-ops.md`, `fixtures/reduce/`, `fixtures/codec/` | V1 (codec, reducer), V2 (admission), V3, V8 (ingestion) |
| `authorize`: every op × actor class × volume kind; reading; workspace permissions | `vfs-authorize.md`, `fixtures/authorize/` | V1 (function), V2, V3, V4, V6, V8 |
| Signed ops: layout, domain, ML-DSA-65, the agent request, key directory, reader states | `vfs-signing.md`, `fixtures/codec/sign-kat.json` | V9; V1 (codec); V2, V3, V8 (verify) |
| Wire: kernel protocol, blob binding, pair sync, outsider calls, routing, caps | `vfs-wire.md`, `fixtures/routing/` | V2 (kernel), V3 (pair), V5, V7 |
| Group volumes on the SDK's ordered broadcasts; what V8 requires of lane SDK-ORDER | `vfs-group.md`, `fixtures/reduce/12-*`, `17-*`, `18-*` | V8; SDK-ORDER; V1 |
| Outsiders: admission, links, claims, what an outsider may do, the transient-session boundary, browser download, `LinkGrant::VfsEntry` | `vfs-outsiders.md` | V7; V1, V2, V3, V8, V9 |
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
| VFS op kinds | 1 `Create`, 2 `Place`, 3 `SetPointee`, 4 `Remove`, 5 `Restore`, 6 `Purge`, 7 `Chmod`, 8 `Chown`, 9 `Admit`, 10 `Dismiss`, 11 `Claim` |
| Header and body keys, `Pointee` and `Principal` tags | `vfs-ops.md` §2, `vfs-model.md` §3, §4 |
| Signature domains | `citadel-vfs-op-v1`; links: `citadel-vfs-claim-v1`, `citadel-vfs-resume-v1` |
| Derivation domains | `citadel-vfs-inode-v1`, `citadel-vfs-migrate-v1`, `citadel-vfs-link-v1`, `citadel-vfs-link-id-v1` |
| Agent wire | requests `VfsSignOps`, `VfsInvitationOpen`, `VfsInvitationProve`; responses `VfsOpsSigned`, `VfsSignFailure`, `VfsInvitationOpened`, `VfsInvitationProved` (the WASM stamp changes); the group `seq` fields and fetch are SDK-ORDER's |
| Workspace protocol | `WorkspaceProtocolRequest::Vfs`, `WorkspaceProtocolResponse::Vfs`, `WorkspaceProtocolResponse::TransientRefused`; `AppsRequest::SetFsConsentForMe`; `LinkGrant::VfsEntry`; optional `VfsDocuments` (V5) |
| P2P | `P2PCommandType.VfsSync`; group envelope tags `citadel-vfs/1`, `citadel-cdoc/1` |
| Kernel config | section `[vfs]`; workspace settings `vfs_retention_days`, `vfs_browser_links` |
| Crate | `citadel-vfs`, in the agent repository beside `citadel-identity` |
| Reserved, not built | a server attestation over `(group, seq, message hash)` (the `att` field, `vfs-group.md` §4): evaluated by SDK-ORDER |

## Who owns which implementation

| Lane | Owns |
|---|---|
| V1 | `citadel-vfs`: model, name rules and tables, codec, reducer, `authorize`, derived views, `migrate`; the corpus on native and wasm; extending `scripts/check-batch-contracts.mjs` (or a sibling gate) to these fixtures |
| V2 | kernel: `[vfs]`, the log store, admission, blob staging and reads, redaction, retention purge, `Permission::ManageFiles`, kernel migration passes, the `via` check |
| V3 | client: the wasm binding, volume replicas, pair sync, key pins, client migration passes; the TS `revfs` merge retires |
| V4 | File Manager on volumes (`vfs-ui.md` §1, §3–§6) |
| V5 | chat documents and files as entries; "Navigate to Folder" (`vfs-ui.md` §2) |
| V6 | `citadel-app-sdk-types` group 19, the guest SDK (`fs`, `vfs`, `task`), the ABI inspector rule, the host port, manifest fields and their TS mirror |
| V8 | group volumes (`vfs-group.md`), on what lane SDK-ORDER provides |
| SDK-ORDER | the thirteen requirements of `vfs-group.md` §5 |
| V9 | `citadel-identity` additions, the agent's `VfsSignOps`, kernel and client verification, the key directory |
| V7 | outsiders (`vfs-outsiders.md`): the invite dialog, "Outside access", the link landing and download pages |

## Decided by the owner (2026-11-24, two rounds)

- Every app writes through the VFS; there is one way for an app to store a file. Key-value
  settings stay an API, shown read-only per app as `/Applications/<app>/Settings`.
- Peer groups get volumes in this release, and **the SDK orders them**: a group volume is an
  ordered volume whose order is the group's sequence numbers; nothing is merged by stamp there.
- Outsiders are a class of their own with read/write/execute per tree node (the third triple
  of every mode), and every recommendation on them is accepted: admission is to a subtree; an
  outsider never admits others, never runs an app, never owns (what it creates belongs to the
  member who admitted it); caps per admission, counted against the inviter; a dismissed
  outsider's key is refused from then on; an outsider sees only what it was let into and the
  authors of that; a link guest may change files with a key made for that invitation and may
  hand its access to an identity it creates; plain browser download is read-only, off by
  default per workspace, never for RE-VFS, and only from the server; in pair and group
  volumes members' devices serve outsiders; the workspace server serves a transient session
  the identity check and claiming an invitation, and nothing else.
- The Recycle Bin shows every removed entry of a volume to all its members.
- Retention before automatic purge: 30 days, set by an administrator.
- The host of an RE-VFS file may delete it only to the bin; the owner is told; the host purges
  only once retention has passed or the owner agreed.
- Tree ops are author-signed with ML-DSA.
- `ManageFiles` is a new permission.
- Names are case-insensitive and case-preserving, and the File Manager behaves as a desktop
  file browser does.
- Received transfers go to one `/Transfers` per pair; old "Sent Files" lists do not migrate.
- Every member of a volume sees all its names; the UI says so (`vfs-ui.md` §7).
- A document made in a chat is a file where that chat stores things; `sdk::fs` maps every
  `std::fs` item for Standard and RE-VFS; `/Applications` holds the apps; a golden lock for the
  host and a green mark for the owner (the request itself).

## Ruled by the orchestrator on V0's questions

The SDK group's owner is the group volume's administrator. Retention (and browser links) are
set by `ManageFiles` on the workspace root. Personal volumes are gated by `UploadFiles` /
`DownloadFiles` on the workspace root. Installer permissions: `fs.app` → `AppInstallAllowStorage`;
`fs.read` / `fs.write` → `AppInstall`; `fs.volume.*` → `AppInstallAllowFiles` and the member's
consent. An administrator purging a departed member's RE-VFS file waits out retention.
`/Groups/<name>` is in the File Manager's root. The header/body split with exact `Purge`,
`fs::Io<T>`, the inspector rule, `citadel-vfs` in the agent repository, `via`, and grammar-only
signing checks for `node:` are accepted as frozen.

## Frozen by V0 as engineering choices (each can be reopened by the orchestrator)

1. One reducer, two kinds of position: the sequence in Ordered volumes (kernel `seq`; group
   `(seq, index)`), the stamp `(lamport, author, op_id)` in Merge volumes (Pair, Device).
2. In a group every member is a verifier: the same checks the kernel makes, made at each
   position by everyone, with a skip where the kernel would refuse; an author's key is bound
   by the log so all members judge by one key.
3. A group's catch-up past what the server keeps, and a joiner's earlier state, come by state
   transfer from a member, accepted only when its hash matches what was offered; a server
   attestation of positions is reserved (`att`) and evaluated by SDK-ORDER.
4. A link has two secrets: the server's token (quota, expiry, browser download) and a secret
   the inviter's client makes and keeps in the URL fragment, from which the link's key is
   derived. A `Claim` carries the link key's signature, so members' devices can check it with
   no server. (The secure link's token is made by the server, so it cannot be that secret.)
5. A transient session becomes **bound** to one admission after an accepted claim and is then
   served the four outside calls for that admission; unbound, it is served the identity check
   and the claim only. (Without this a link guest could claim and then neither read nor write.)
6. An outsider is served a view of its subtree, never the log; it checks signatures and relies
   on whoever serves it for the tree's shape.
7. In a Pair volume, which has no positions, `Dismiss` names the last op of the outsider it
   accepts (`lasts`), so a late op cannot be slipped in by its stamp.
8. `SIGNED_OP_MAX_BYTES` is 12 288 (a `Claim` carries a key and two signatures).
9. A message is signed over `domain ‖ 0x00 ‖ header`, as everything in `citadel-identity` is.
10. Hashes: SHA3-256 for ids and op hashes; SHA-256 only for content ids. Canonical CBOR with
    integer keys and no `null`, so `scripts/lib/contracts/cbor.mjs` reads every fixture.
11. Names: Unicode 17.0.0, NFC required (refused, not repaired), unassigned code points refused,
    simple case folding (statuses C and S).
12. Limits of volumes without a kernel are constants every replica shares; the kernel's are the
    operator's `[vfs]` keys, all required.
13. A document's title is its entry's name from migration on.
14. `Restore` only clears `removal`; a taken name is shown as `name (2)` by the general rule.
15. Retention in pair, group and device volumes is the constant `PEER_RETENTION_MS` and nothing
    purges there automatically.
16. The VFS lanes add no member to `CID_ROUTED_NOTIFICATIONS`; SDK-ORDER adds its own.
17. A `LiveDoc` in a Personal volume is refused unless V5 builds the optional kernel address
    (`vfs-wire.md` §3.1).
18. In this release an account that replaces its identity key cannot write to a group volume it
    wrote to under the old key.

## Next release

Foreign Citadel identities as outsiders (an identity with no account on this server).

## Fixtures

| Directory | Holds | Format |
|---|---|---|
| `fixtures/reduce/` | 20 op sets with the expected tree, one reducer rule each (named in `rule`); the group sets carry each op's `seq`, `index` and carrier | ops and entries as JSON models; `"root"` stands for the volume's root id (also given as `root`); a principal is `[0]` or `[1, cid]`; modes are decimal; the reducer is given verified ops, so no signature and no `prev` appear |
| `fixtures/authorize/cases.json` | 80 cases over five trees, each naming its cell of `vfs-authorize.md` | `expect` is `"ok"` or the `Denied` value |
| `fixtures/codec/` | headers and bodies as `cbor_hex` + `model`, their hashes, the bytes a signature covers, derived ids, three refusals | the notation of `batch-1116/sw-wire.md` §1 |
| `fixtures/names/cases.json` | valid and invalid names; pairs that collide and pairs that do not | UTF-8 JSON strings |
| `fixtures/routing/shapes.json` | the two signing answers' shapes | as `SHAPES` in `cid-routed-notifications.test.ts` |

The expected trees and the authorize answers were worked out by hand from the rules; the hex
was computed with `scripts/lib/contracts/cbor.mjs` and Node's SHA3-256 and round-trips through
the reference decoder. V1 wires them into the contracts gate. Changing a frozen contract:
change the file, change the fixtures, and tell every lane in its "built by" column in the same
message as the commit.
