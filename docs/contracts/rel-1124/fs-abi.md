# Contract: apps ABI group 19 `fs` — FROZEN 2026-11-24, revised round 2

Parties: V6 (SDK types, guest SDK, ABI inspector, host port, kernel check), V2 (`via` on
`VfsRequest`), V4 (picker, open-with). The guest-facing surface (`sdk::fs`, `sdk::vfs`):
`sdk-fs-surface.md`. Encoding of every call and event: the SDK's CBOR codec (`codec.rs`).
`fs` is the only way an app stores or reads a file.

## 1. Numbers reserved

```rust
// citadel-app-sdk-types/src/abi.rs
pub const ABI_MINOR_FS: u32 = 2;
pub const ABI_MINOR: u32 = ABI_MINOR_FS;
// ops/mod.rs, after Session = 18 (17 stays reserved for identity)
Fs = 19, "fs", FsOps { … §3 … }
// ffi.rs: `fn fs(op: i32, ptr: i32, len: i32) -> i32;` and the `Group::Fs` arm
// lifecycle.rs
pub const CLOSING_GROUPS: [Group; 3] = [Group::Storage, Group::Log, Group::Fs];
// context.rs
impl AppContext { pub fn has_fs(&self) -> bool { self.sdk_abi_minor >= abi::ABI_MINOR_FS } }
```

## 2. Capabilities (appended to `capabilities!` after `CitadelSession`, in this order)

| Variant | Name | Reaches | Installer needs (`required_installer_permission`) | Acting member needs (`acting_user_requirement`) | Member's own consent |
|---|---|---|---|---|---|
| `FsApp` | `fs.app` | the install's own directory `/.apps/<app_id>/` (`vfs-model.md` §8) | `AppInstallAllowStorage` | `ViewContent` | none |
| `FsRead` | `fs.read` | an entry the member picked in the host's picker or handed over with "Open with", and what is beneath it | `AppInstall` | none beyond the entry's own rights | the pick itself |
| `FsWrite` | `fs.write` | the same, to change | `AppInstall` | none beyond the entry's own rights | the pick itself, made with "allow changes" |
| `FsVolumeRead` | `fs.volume.read` | every volume of the kinds the manifest lists | `AppInstallAllowFiles` | `DownloadFiles` (Node volumes) | `FsConsent.read` |
| `FsVolumeWrite` | `fs.volume.write` | the same, to change | `AppInstallAllowFiles` | `UploadFiles` (Node volumes) | `FsConsent.write` |

Every call is also judged by `authorize` / `may_read_bytes` for the acting member
(`vfs-authorize.md`): a capability never lets an app do what the member could not.

Manifest (`citadel-workspace-types/src/apps_manifest.rs`, its TS mirror, `apps_manifest_check`):
- `CapabilityRequest.volumes: Option<Vec<FsVolumeKind>>`: present **exactly** for
  `fs.volume.read` and `fs.volume.write`, 1..=5 distinct of `personal | pair | node | device |
  group` (snake_case); any other combination is refused like `hosts`.
- `AppLimits.fs: Option<FsLimits>`: present exactly when the manifest asks for any `fs.*`.
  ```rust
  pub struct FsLimits {
      pub max_file_bytes: u64,     // 1 ..= FS_MAX_FILE_BYTES_CEILING: one file an app writes
      pub max_open_files: u32,     // 1 ..= FS_MAX_OPEN_FILES_CEILING
      pub max_ops_per_s: u32,      // 1 ..= FS_MAX_OPS_PER_S_CEILING: tree changes; token bucket, burst = the limit
  }
  ```
- Consent, beside `PeerConsent` (`apps_peer.rs`):
  ```rust
  pub struct FsConsent { pub read: bool, pub write: bool, pub at_ms: u64 }   // NONE = both false, 0
  AppsRequest::SetFsConsentForMe { install_id: String, consent: FsConsent }
  ```
  Without it `fs.volume.*` is not effective for that member, whatever the grant says.

## 3. Ops

`granted_by` is `args` for every op (as the KV ops): the place decides the capability
(`FsPlace::required_capability(write: bool)`): `App` → `FsApp`; `Picked` → `FsRead` / `FsWrite`;
any other target → `FsVolumeRead` / `FsVolumeWrite`. Ops on a descriptor use the capability it
was opened under.

```rust
abi_types! {
    #[serde(rename_all = "snake_case")]
    pub enum FsTarget {
        App,                                   // the install's home
        Server,                                // the member's Personal volume
        Peer { cid: u64 },                     // pair volume with that member
        Node { node_id: String },
        Device,
        Group { creator: u64, mgid: String },  // mgid: decimal u128
        Picked { grant: u32 },                 // an entry the member handed this instance
    }
    #[serde(rename_all = "snake_case")]
    pub enum FsStorage { Standard, Revfs }
    pub struct FsPlace { pub target: FsTarget, pub storage: FsStorage }

    pub struct FsOpenFlags { pub read: bool, pub write: bool, pub append: bool,
                             pub truncate: bool, pub create: bool, pub create_new: bool }
    pub struct FsMetadata {
        pub volume: String, pub inode: Bytes, pub name: String, pub is_dir: bool, pub len: u64,
        pub mode: u16, pub owner: u64, pub created_ms: u64, pub modified_ms: u64,
        pub state: VfsState,
    }
    #[serde(rename_all = "snake_case")]
    pub enum VfsState { Shared, Revfs { role: RevfsRole }, Removed }
    #[serde(rename_all = "snake_case")]
    pub enum RevfsRole { Owner, Host, Other }
    pub struct EntryRef { pub volume: String, pub inode: Bytes }

    #[serde(rename_all = "snake_case")]
    pub enum FsResult<T> { Ok(T), Err(FsError) }
    pub struct FsError { pub kind: FsErrorKind, pub detail: String }
    #[serde(rename_all = "snake_case")]
    pub enum FsErrorKind {
        NotFound, PermissionDenied, AlreadyExists, NotADirectory, IsADirectory, DirectoryNotEmpty,
        InvalidInput, InvalidFilename, InvalidData, Unsupported, CrossesDevices, StorageFull,
        QuotaExceeded, FileTooLarge, ReadOnlyFilesystem, ResourceBusy, NotConnected, Other,
    }
}
```
Every `Fs*` and `Vfs*` op's reply is `FsResult<…>` of the type shown. An outcome of the
filesystem (not found, not allowed, full) is an `FsError`; a `Refused` (`refused.rs`) keeps its
meaning (the install lacks the capability, the host cannot serve it, a host limit).

| # | Op (argument struct) | Fields | Reply |
|---|---|---|---|
| 1 | `FsOpen` | `place, path: String, flags: FsOpenFlags` | `FsFd { fd: u32, len: u64 }` |
| 2 | `FsClose` | `fd` | `()` (commits a written file) |
| 3 | `FsReadAt` | `fd, offset: u64, len: u32` (`len <= FS_MAX_IO_BYTES`) | `BytesValue` (short at end of file) |
| 4 | `FsWriteAt` | `fd, offset: u64, bytes: Bytes` (`<= FS_MAX_IO_BYTES`) | `FsWritten { n: u32 }` |
| 5 | `FsSetLen` | `fd, len: u64` | `()` |
| 6 | `FsSync` | `fd` | `()` (the commit point) |
| 7 | `FsStat` | `place, path` | `FsMetadata` |
| 8 | `FsFstat` | `fd` | `FsMetadata` |
| 9 | `FsReadDir` | `place, path, cursor: Option<String>` | `FsDirPage { entries: Vec<FsMetadata>, next: Option<String> }` |
| 10 | `FsCreateDir` | `place, path, recursive: bool, mode: u16` | `()` |
| 11 | `FsRemove` | `place, path, what: FsRemoveKind` (`file \| dir \| dir_all`) | `()` (to the Recycle Bin) |
| 12 | `FsRename` | `place, from: String, to: String` | `()` |
| 13 | `FsCopy` | `from_place, from, to_place, to` | `FsCopied { len: u64 }` |
| 14 | `FsSetMode` | `place, path, mode: u16` | `()` |
| 15 | `FsChown` | `place, path, owner: u64` | `()` |
| 16 | `FsCanonicalize` | `place, path` | `Text` |
| 17 | `VfsVolumes` | — | `VolumeList { volumes: Vec<VolumeInfo { volume, kind: FsVolumeKind, label, members: Vec<u64> }> }` |
| 18 | `VfsEntry` | `place, path` | `FsMetadata` |
| 19 | `VfsTrash` | `entry: EntryRef` | `()` |
| 20 | `VfsRestore` | `entry` | `()` |
| 21 | `VfsDeleteForever` | `entry` | `()` |
| 22 | `VfsRecycleBin` | `volume: Option<String>, cursor: Option<String>` | `BinPage { entries: Vec<BinEntry { meta: FsMetadata, was_at: String, removed_by: u64, removed_ms: u64 }>, next }` |
| 23 | `VfsConvert` | `entry, storage: FsStorage` | `()` |
| 24 | `VfsWatch` | `place, path` | `WatchOpened { watch: u32 }` |
| 25 | `VfsUnwatch` | `watch: u32` | `()` |
| 26 | `VfsPick` | `pick: PickRequest { dirs: bool, write: bool, extensions: Vec<String> }` | `Picked { grant: Option<u32>, meta: Option<FsMetadata> }` (`None`: the member cancelled) |
| 27 | `VfsOpenInApp` | `entry` | `()` |
| 28 | `VfsApplications` | — | `AppLinkList { apps: Vec<AppLink { app_id, install_id, name, runnable: bool }> }` |
| 29 | `VfsReveal` | `entry` | `()` (opens the File Manager at it) |
| 30 | `VfsAdmit` | `entry, who: AdmitWho` (`member { cid }` \| `link { max_claims: u32, browser_download: bool }`), `write: bool, expires_ms: u64, caps: AdmitCaps { max_bytes: u64, max_entries: u32, max_ops_per_min: u32 }` | `AdmitResult { link: Option<String> }` (the link URL, this once). Always behind the host's own invite dialog, which the member confirms; needs `fs.volume.write` or a writable pick of `entry` |
| 31 | `VfsDismiss` | `entry, who: DismissWho` (`member { cid }` \| `link { link_id: String }`) | `()`; the same capability |

Events (`event.rs`), both ABI minor 2 and delivered only to a guest whose `events` subscription
is open, as topics are:
```rust
AppEvent::Vfs { watch: u32, event: VfsEvent }
#[serde(rename_all = "snake_case")]
pub enum VfsEvent { Created { meta: FsMetadata }, Placed { meta: FsMetadata }, Changed { meta: FsMetadata },
                    Removed { entry: EntryRef }, Restored { meta: FsMetadata }, Purged { entry: EntryRef } }
/// A file the member chose to open in this app, as a grant instead of bytes. Sent in place of
/// `OpenFile` to an install that holds `fs.read`; an install without it still gets `OpenFile`.
AppEvent::OpenEntry { grant: u32, meta: FsMetadata }
```

## 4. Rules (pure module `fs-rules` in the UI host directory and its Rust mirror; table tests)

- **Paths** are UTF-8, `/`-separated, relative to the place's root (a leading `/` is allowed),
  at most `FS_PATH_MAX_BYTES = 4096`, resolved by shown names (`vfs-ops.md` R11). `.` and `..`
  are resolved lexically; `..` above the root is `InvalidInput`; a component that is not a
  valid `Name` is `InvalidFilename`. There are no links, so resolution never leaves the place.
- `FsTarget::App` resolves by the install's scope (`vfs-model.md` §8) and exists from the first
  call. `Picked { grant }` roots the path at the granted entry; a grant belongs to the instance
  that received it and ends with it; an unknown grant is `Refused::Policy("no_grant")`.
- `FsStorage` chooses where **new** bytes go. Reads follow the entry's own pointee.
- A written descriptor buffers in the host, at most `limits.fs.max_file_bytes`
  (`FileTooLarge`), and commits at `FsSync` / `FsClose` as one new object and one
  `Create` / `SetPointee`. There is no partial write in place.
- Removal is `Remove` (the Recycle Bin); only `VfsDeleteForever` purges.
- RE-VFS: reading or opening for read by anyone but the pointee's owner is `PermissionDenied`
  with `detail = "revfs_host"` or `"revfs_other"`. `FsCopy` of an RE-VFS file by its owner
  re-stores it; by anyone else `PermissionDenied`.
- `FsRename` stays inside one place (it has one). `FsCopy` across places streams through the
  host; a move across places is a copy and a removal, and a caller that asks one op for it is
  answered `CrossesDevices`.
- Limits answered at once: over `limits.fs.max_ops_per_s` → `Refused::Limit("fs_rate")`; over
  `max_open_files` → `Refused::Limit("fs_open_files")`; an oversize read or write argument →
  `Refused::Limit("fs_io_bytes")`.
- A write when the member's identity is locked: the host asks the member to unlock and retries
  once; declined, or no identity, is `PermissionDenied` with `detail = "identity"`.

## 5. Who performs a call

Every `fs` call is performed by the **page host** through the member's volume replica (V3), so
an app's change is an ordinary op signed by the member (`vfs-signing.md`): the `fs` group does
not travel in `AppsRequest::Call`.
- Personal and Node volumes: the host sends the resulting `VfsRequest`s with the new field
  `via: Option<AppVia>`, `AppVia { install_id: String }`. With `via` the kernel checks, before
  anything else and at every call: the install exists, reaches the caller and is not suspended;
  its effective grant (narrowed to what its installer still holds) covers the call: `fs.app`
  only when every op's target and parent, or the entry read, lie under that install's home in
  that volume (the kernel's own tree); `fs.volume.*` only when the manifest lists the volume's
  kind and the member's `FsConsent` allows it; `fs.read` / `fs.write` only that the install
  holds it (the pick is the member's act in the host). A failure is
  `VfsRefusal::App(AppsRefusal)` (`vfs-wire.md` §3). Then the ordinary checks run.
- Pair, Device and Group volumes have no kernel: the host's own check of the grant is the only
  one before `authorize`.

## 6. Retired in ABI minor 2

| Retired | Was | From this release |
|---|---|---|
| group `Files = 6` (`FilesList = 1`, `FilesRead = 2`, `FilesWrite = 3`, `FilesDelete = 4`) | declared, answered unavailable | every call answers `Refused::Unavailable("retired")`; the number is never reused |
| `StoreFileWrite = 9`, `StoreFileRead = 10`, `StoreFileList = 11` (group `Storage`) | declared, answered unavailable | the same |
| `BlobPut = 6`, `BlobGet = 7`, `BlobDelete = 8` (group `Storage`) | sha256 blobs | the same; an app's blobs are files under its home |
| capabilities `files.read`, `files.write`, `storage.files`, `storage.blob` | grantable | the variants stay (stored installs must still decode); a manifest that declares one is refused (`ManifestRefusal::RetiredCapability`) |

The SDK keeps `storage::blob::{put, get, delete}` for this minor as wrappers over `fs`
(`fs.app`, path `blobs/<sha256 hex>`), and drops `storage::files`. Group and op numbers 6 and
6..=11 stay as gaps; `StorageBackend::{Blob, Files}` stay decodable and are never sent.

**ABI inspector** (`citadel-app-abi-inspect/src/rules.rs`): a module that imports `files` from
`citadel_app_abi_1` is rejected (`Rejection::RetiredGroup`), whatever its manifest declares. The
retired `storage` ops share the `storage` import with KV, so no import names them: they are
refused when called. A module that imports `fs` needs a declared `fs.*` capability, by the
existing rule. The host applies the same two rules at load.

## 7. Limits (constants of `citadel-app-sdk-types`, exported to `AbiConstants.ts`)

`FS_MAX_IO_BYTES = 1_048_576`, `FS_PATH_MAX_BYTES = 4096`, `FS_MAX_FILE_BYTES_CEILING =
268_435_456` (`MAX_OPEN_FILE_BYTES`), `FS_MAX_OPEN_FILES_CEILING = 64`,
`FS_MAX_OPS_PER_S_CEILING = 16`, `FS_DIR_PAGE_MAX = 256`, `FS_MAX_WATCHES = 16`; limit names
`LIMIT_FS_RATE = "fs_rate"`, `LIMIT_FS_OPEN_FILES = "fs_open_files"`, `LIMIT_FS_IO_BYTES =
"fs_io_bytes"`. Every one a host enforces is in the manifest's `limits.fs` or this list.

## 8. Tests V6 owes

The op table round-trips (`bindings/AbiConstants.ts` regenerated); the capability table against
`rules.rs` (control: map `fs.volume.write` to `AppInstall` → red); the inspector rejects an
`files` import (control: remove the rule → accepted → red); `fs-rules` table; a fixture app
that calls every row of `sdk-fs-surface.md` on Standard and RE-VFS; with `via`, an `fs.app`
install is refused a path outside its home by the kernel with a host that does not check
(recording transport; control: drop the kernel check → the op is admitted → red).
