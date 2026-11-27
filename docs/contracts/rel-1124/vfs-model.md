# Contract: VFS model (`citadel-vfs`) — FROZEN 2026-11-24, revised round 2

Parties: V1 (the crate), V2 (kernel), V3 (client), V4 (File Manager), V5 (chat documents), V6
(`sdk::fs`), V8 (peer groups), V9 (signing). Ops and the reducer: `vfs-ops.md`. Who may do what:
`vfs-authorize.md`. Outsiders: `vfs-outsiders.md`. Group volumes: `vfs-group.md`. Bytes on the wire: `vfs-ops.md` §2, `vfs-signing.md`, `vfs-wire.md`.

The crate is `citadel-vfs`, in the agent repository beside `citadel-identity`
(`citadel-internal-service/citadel-vfs/`), pure (no I/O, no clock, no randomness: all three are
arguments), built natively and for `wasm32-unknown-unknown`. The agent, the kernel and the page
all link the same code. Hashes: **SHA3-256** for ids, op hashes and chains (the identity crate's
family); **SHA-256** only for content ids (`sha256`, the existing blob convention).

## 1. Volumes

A volume is one tree, one op log and a derived member set. Its id is derived, never chosen.

| Kind | Id (ASCII, decimal numbers without leading zeros) | Members (derived, never stored in the tree) | Mode | Authority | Log lives | Bytes live |
|---|---|---|---|---|---|---|
| Personal | `personal:<cid>` | that account | Ordered | workspace kernel | kernel | kernel store; RE-VFS hosted by the server |
| Pair | `pair:<lo>:<hi>`, `lo < hi` | the two accounts | Merge | none | each agent's LocalDB | Standard: each side's agent; RE-VFS: the host's agent |
| Node | `node:<node_id>`, `node_id` = 1..=128 of `[A-Za-z0-9_-]` | accounts holding `ViewContent` on the node, as the kernel computes it at the time of each request | Ordered | workspace kernel | kernel | kernel store |
| Device | `device:<cid>` | that account, on this device | Merge (one replica) | none | agent LocalDB | agent LocalDB |
| Group | `group:<creator_cid>:<mgid>` (`MessageGroupKey { cid, mgid }`, `mgid` decimal u128) | the SDK group's members at each position, from the group's own membership events | Ordered | the group's relay numbers; every member verifies and authorizes; the group's owner administers | each agent's LocalDB | Standard: any holder, pairwise; RE-VFS: the named host |

- A volume id is at most `VOLUME_ID_MAX_BYTES = 192` bytes. `pair:` with `lo == hi` does not exist
  (a conversation with oneself is the Device volume). Anything else is `VolumeId::Malformed`.
- **Ordered**: every op has a position in one sequence and is judged at that position.
  Personal and Node: the kernel verifies, authorizes and numbers each op (`seq`, from 1). Group:
  the group's relay numbers each broadcast and every member's replica verifies and authorizes
  at that position (`vfs-group.md`). **Merge** (Pair, Device): no order exists between replicas;
  every replica folds the op set it holds in stamp order (`vfs-ops.md` §4). One reducer serves
  all.
- A Device volume is never synced: two devices of one account hold two unrelated `device:<cid>`
  trees.
- `citadel_types::user::username_to_cid` is how a kernel turns a member's username into the
  `cid` used here, and the account manager turns it back.

## 2. Identifiers

```
InodeId = 16 bytes.           Text form: 32 lowercase hex characters.
random  : 16 bytes from the caller's CSPRNG.
derived : SHA3-256("citadel-vfs-inode-v1" ‖ 0x00 ‖ lp(volume_id) ‖ lp(namespace) ‖ lp(key))[..16]
lp(s)   : u16be(len(s)) ‖ s        (UTF-8; `citadel-identity`'s `put_str16`)
```

| namespace | key | used for |
|---|---|---|
| `root` | empty | the volume's root directory |
| `seed` | the directory's name | `Documents`, `Chat files`, `Transfers`, `.apps` at the root |
| `app-home` | the app id (`citadel-app-id` grammar) | `/.apps/<app_id>` |
| `revfs-dir` | the legacy path, NFC, `/`-joined, leading `/` | a migrated RE-VFS directory |
| `revfs-file` | `RevfsFileMetadata.fileId` | a migrated RE-VFS file |
| `transfer` | the transfer id | a migrated received transfer |
| `chat-doc` | the document id | a chat document |
| `chat-file` | the attachment id (64 hex) | a migrated node-chat file |

Known answers: `fixtures/codec/inode-kat.json`. Two importers of one legacy item produce one id.

## 3. Principal

```rust
pub enum Principal { Server, Member { cid: u64 }, LinkGuest { link_id: [u8; 16], key_fp: String } }
```
CBOR: `[0]`, `[1, cid]`, `[2, link_id bstr(16), key_fp tstr(16)]`. A `Member` is any account of
the workspace's server, a member of the volume or an outsider of kind A; a `LinkGuest` is an
outsider that claimed a link with an invitation key (`vfs-outsiders.md` §1). Principals order by
the bytes of their canonical encoding (so `Server < Member < LinkGuest`, members by `cid`).

## 4. Entry

| Field | Type | Register | Written by |
|---|---|---|---|
| `id` | `InodeId` | immutable | `Create` |
| `kind` | `Dir = 1`, `File = 2` (`AppLink = 3` exists only in the derived `/Applications`) | immutable | `Create` |
| `created` | `{ by: Principal, at_ms: u64 }` | immutable | `Create` |
| `place` | `{ parent: InodeId, name: Name }` | LWW | `Create`, `Place` |
| `pointee` | `Pointee` | LWW | `Create`, `SetPointee` |
| `owner` | `Principal` (a member; `Server` only where the server created an entry with no member to name) | LWW | `Create`, `Chown` |
| `mode` | `Mode` | LWW | `Create`, `Chmod` |
| `removal` | `Option<{ by: Principal, at_ms: u64 }>` | LWW | `Remove` sets, `Restore` clears |
| `admissions` | `Map<Admitted, { by: Principal, expires_ms: u64, caps: [u64; 3], claims: [key_fp] }>`; `Admitted = [1, cid, id_fp] \| [2, link_id, link_pk, max_claims]`, keyed by `[1, cid]` or `[2, link_id]` | LWW per key | `Admit` sets, `Dismiss` clears, `Claim` adds a claim (`vfs-outsiders.md`) |

`modified` is not stored: it is the `at_ms` of the op that last won the `pointee` register (for a
directory, of the op that last won its `place`). `at_ms` is the author's wall clock, shown to
people and never used to order anything.

**Root.** Every volume has a root directory with the derived id of namespace `root`. No op
creates, places, removes or purges it. Its `mode` starts as `ROOT_MODE = 0o770`; its `owner` is
the account for Personal and Device, `Server` for Node, the group's creator for Group, and
unused for Pair (both members are owners of everything there, `vfs-authorize.md` §3).

```rust
pub enum Pointee {
    None,                                                           // [0]   every directory
    Standard { sha256: [u8; 32], len: u64, mime: String },          // [1, bstr32, uint, tstr]
    Revfs { owner: u64, host: Principal, virtual_path: String, len: u64, mime: String },
                                                                    // [2, uint, Principal, tstr, uint, tstr]
    LiveDoc { doc_id: String },                                     // [3, tstr]
}
```
- `Standard`: content-addressed in the volume's blob store. `mime` is `type/subtype`, at most
  `MIME_MAX_BYTES = 127` (the `chat_attachments` rule), or empty.
- `Revfs`: `owner` (a member's cid) is the only reader; `host` (`Server` or `Member`) stores the
  ciphertext; `virtual_path` is the key the host stores it under (1..=`VIRTUAL_PATH_MAX_BYTES =
  512`), opaque and random for new objects (`r/<32 hex>`), the legacy path for migrated ones;
  `len` is the plaintext length.
- `LiveDoc`: a Citadel Docs document, `doc_id` 1..=128 bytes with no `#`, `:` or whitespace (the
  `isChatDocId` rule). Its bytes are its own update log, addressed by the volume and `doc_id`.
- A directory's pointee is always `None`; a file's is never `None` after `Create`.

**Derived state** (never stored): `removed` if the entry or any ancestor has `removal` set; else
`revfs` if its pointee is `Revfs`; else `shared`.

## 5. Mode

`Mode` is a `u16`; only the low nine bits may be set (`0o777`), laid out as on Linux:
`owner rwx` (0o700), `members rwx` (0o070), `outsiders rwx` (0o007).

| Bit | Directory | File |
|---|---|---|
| r | list names | read bytes |
| w | create, rename, remove and restore children | replace bytes |
| x | traverse | nothing (no file is ever executed) |

Reaching an entry needs `x` on every ancestor. Named values a client offers when the person
states none (an op always carries its mode; nothing is implied by the reducer):
`DEFAULT_DIR_MODE = 0o770`, `DEFAULT_FILE_MODE = 0o660`, `APP_HOME_MODE = 0o770`. The outsider
triple is what an outsider admitted to this entry, or to a folder above it, may do here.

## 6. Name

A `Name` is valid exactly when all hold (a violation is refused, never repaired):
1. it is well-formed UTF-8 of 1..=`NAME_MAX_BYTES = 255` bytes;
2. it is in NFC (Unicode **17.0.0**; `unicode-normalization = "=0.1.25"`, already in both
   lockfiles);
3. every code point is assigned in Unicode 17.0.0 (so a later Unicode cannot change its NFC);
4. it has no `/` (U+002F) and no code point of general category `Cc` (U+0000..=U+001F,
   U+007F..=U+009F);
5. it is not `.` and not `..`.

**Comparison key** (case-insensitive, case-preserving):
`fold_key(name) = NFC(simple_case_fold(name))`, where `simple_case_fold` maps each code point by
`CaseFolding-17.0.0.txt`, statuses `C` and `S` only (never `F`, never `T`). The table is compiled
into `citadel-vfs`; a test holds it to the file's SHA-256. Two siblings **collide** when their
fold keys are equal. The stored name keeps its case; `Report.md` and `report.md` collide.

Fixtures: `fixtures/names/cases.json`.

## 7. Limits (named; no implicit value anywhere)

Protocol ceilings (constants of the crate):
`NAME_MAX_BYTES 255`, `DEPTH_MAX 64` (root is depth 0), `SIGNED_OP_MAX_BYTES 12288`,
`MIME_MAX_BYTES 127`, `VIRTUAL_PATH_MAX_BYTES 512`, `DOC_ID_MAX_BYTES 128`,
`VOLUME_ID_MAX_BYTES 192`.

```rust
pub struct VolumeLimits {            // every field required wherever the struct is built
    pub max_entries: u32,            // live + removed, per volume
    pub max_entries_per_dir: u32,
    pub max_depth: u8,               // <= DEPTH_MAX
    pub max_log_ops: u64,
    pub max_blob_bytes: u64,         // one file
}
```
- **Personal and Node volumes**: the kernel reads `[vfs]` from `kernel.toml`, every key required
  (`max_entries`, `max_entries_per_dir`, `max_depth`, `max_log_ops`, `max_blob_bytes`,
  `max_ops_per_minute`, `max_append_ops`, `max_ops_per_pull`, `staged_blob_grace_ms`,
  `at_skew_ms`, `outsider_caps_max_bytes`, `outsider_caps_max_entries`,
  `outsider_caps_max_ops_per_min`, `transient_claims_per_minute`); a missing key stops the kernel at start, as `[documents]` does. The limits are
  admission checks there (`vfs-wire.md` §3), never reducer rules. Retention before automatic
  purge is a workspace setting (`vfs_retention_days`, 1..=365, set by a holder of
  `ManageFiles` on the workspace root; a workspace is created with 30). `vfs_browser_links`
  (`vfs-outsiders.md` §7) is set by the same holder; a workspace is created with it off.
- **Volumes without a kernel** (Pair, Device, Group): every replica must agree, so the limits are one constant of the crate,
  `PEER_VOLUME_LIMITS = VolumeLimits { max_entries: 65_536, max_entries_per_dir: 4_096,
  max_depth: 64, max_log_ops: 1_048_576, max_blob_bytes: 4 GiB }`, and
  `PEER_RETENTION_MS = 30 days`. They are reducer rules there (`vfs-ops.md` §4, rule R7).

## 8. Derived places (never in any log)

| Place | What it is |
|---|---|
| `/Applications` | one `AppLink` per install that reaches the viewer (`AppsRequest::ListInstalls` and the listing's icon). Read-only. Its `x` bit is "the install reaches me"; changing it is the install's scope control. Each link has one derived child `Settings` (the install's KV: size, last change, "Reset"), read-only. |
| `/Recycle Bin` | the top-most removed entries of every volume the viewer is in, each with its original parent path, `removal.by` and `removal.at_ms`. Every member of a volume sees every removed entry of that volume. |
| `/Shared with me` | one item per live admission of the viewer (`[1, me, …]`) in a volume they are not a member of, rooted at the admitted entry: nothing above it is shown (`vfs-outsiders.md` §5). |

`/.apps/<app_id>/` is **not** derived: it is an ordinary directory (ids of namespaces `seed` and
`app-home`), created by the kernel as a `Server` op the first time the install uses `fs.app`. It
lives in the volume the install's scope names: `Workspace` → the workspace root node's volume;
`Node(n)` and `NodeTree(n)` → `node:<n>`; `SelfOnly` and `Users` → each such member's Personal
volume. A name starting with `.` is hidden in listings unless the viewer asks for hidden items.

## 9. File Manager root (derived from the viewer's volumes and installs)

```
/Applications          derived (§8)
/Recycle Bin           derived (§8)
/My files              personal:<me>
/People/<name>         pair:<lo>:<hi>, one per peer; <name> is the peer's display name
/Groups/<name>         group:<creator>:<mgid>, one per peer group the viewer is in
/Workspace/<node…>     node:<id>, following the workspace's own hierarchy
/This device           device:<me>
/Shared with me        derived (§8)
```
These eight names are fixed UI labels, not entries: nothing can be created, renamed or removed
at this level. Seeded directories inside a volume: `/Documents` (documents made in that
volume's chat), `/Chat files` (files shared in a node's chat), `/Transfers` (files received by
standard transfer in a pair), `/.apps`. A seeded directory is an ordinary entry with a derived
id, created by whoever needs it first.
