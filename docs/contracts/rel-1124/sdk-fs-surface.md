# Contract: `sdk::fs` and `sdk::vfs` (the guest surface) — FROZEN 2026-11-24

Parties: V6. The ABI beneath: `fs-abi.md`. The list of `std::fs` items is taken from the
standard library source of Rust **1.100.0** (the toolchain `scripts/wasm-toolchain.env` pins;
first-party apps pin 1.99.0, which has every stable item below). Unstable items (`fs::Dir`,
`File::open_buffered`, `File::create_buffered`, `set_permissions_nofollow`) have no counterpart.

`citadel_app_sdk::fs` has the names, argument order and `io::Result` of `std::fs`, with a
leading `&Place`. `std::io::ErrorKind` is used as it is.

```rust
use citadel_app_sdk::fs::{self, Place, Target, Storage};
let place = Place::new(Target::Peer(cid), Storage::Revfs);
fs::create_dir_all(&place, "reports/2026").await?;
fs::write(&place, "reports/2026/q4.md", bytes).await?;
let text = fs::read_to_string(&place, "reports/2026/q4.md").await?;
```

## 1. The honest departures from `std::fs`

1. **It is asynchronous.** A browser worker cannot block on a port, so every function returns
   `fs::Io<T>` where `std::fs` returns `io::Result<T>`.
2. **"You" is the signed-in member.** A `Place` names the target and the storage; the acting
   identity is never an argument.
3. (a consequence of 1) `File` has inherent async methods in place of the blocking `Read`,
   `Write` and `Seek` traits, and a read returns its bytes instead of filling a borrowed buffer.

## 2. `Io<T>`

`Pending<T>` (`pending.rs`) is a continuation, not a `Future`, and yields `Result<T, Refused>`.
`sdk::fs` adds one type over it, and the SDK gains the task executor that makes `.await` work:

```rust
pub struct Io<T> { /* a Pending<FsResult<T>> and the mapping to io::Result */ }
impl<T: 'static> Io<T> {
    pub fn then<A: 'static>(self, f: impl FnOnce(&mut A, io::Result<T>) + 'static);   // as Pending::then
    pub fn take_ready(&mut self) -> Option<io::Result<T>>;
    pub fn try_take(&mut self) -> Option<io::Result<T>>;
    pub fn map<U: 'static>(self, f: impl FnOnce(T) -> U + 'static) -> Io<U>;
    pub fn handle(&self) -> Option<i32>;
}
impl<T: 'static> core::future::Future for Io<T> { type Output = io::Result<T>; }
impl<T: 'static> core::future::Future for Pending<T> { type Output = Result<T, Refused>; }

// citadel_app_sdk::task
pub fn spawn(fut: impl core::future::Future<Output = ()> + 'static);
```
A spawned task is polled when spawned and again whenever a reply it awaits is ready
(`AppEvent::ReplyReady`), on the same queue the continuations drain on, never while the app is
borrowed. A dropped `Io` discards its reply, as a dropped `Pending` does. A function that takes
several host calls (`read`, `write`, `copy` across places) chains them inside the SDK and still
returns one `Io`.

Errors: `FsError { kind, detail }` becomes `io::Error::new(kind, detail)` with the `ErrorKind`
of the same name. A `Refused` becomes: `Ungranted`, `Policy(_)` → `PermissionDenied`;
`Limit("fs_rate")` → `ResourceBusy`; `Limit("fs_io_bytes" | "fs_open_files")` →
`QuotaExceeded`; `Unavailable("retired" | "outsiders_pending")` → `Unsupported`; any other
`Unavailable` → `NotConnected`; anything else → `Other`. The original `Refused` is the error's
source.

## 3. `Place`

```rust
pub enum Target { App, Server, Peer(u64), Node(String), Device, Group { creator: u64, mgid: u128 }, Picked(Grant) }
pub enum Storage { Standard, Revfs }
pub struct Place { /* target, storage */ }
impl Place { pub fn new(target: Target, storage: Storage) -> Place; pub fn app() -> Place; /* App, Standard */ }
pub struct Grant(/* u32, from vfs::pick or AppEvent::OpenEntry */);
```
`Storage` chooses where new files go; reads follow each entry's own pointee. Paths are
`impl AsRef<Path>`, relative to the place's root; a path that is not UTF-8 is `InvalidInput`.

## 4. Every `std::fs` item

"S" = Standard, "R" = RE-VFS (reader = the pointee's owner; the host and third members get
`PermissionDenied`). Where a column says only "yes" the behaviour is `std::fs`'s.

### Free functions

| `std::fs` | `sdk::fs` | S | R | Notes |
|---|---|---|---|---|
| `read` | `read(&Place, P) -> Io<Vec<u8>>` | yes | owner only | ranged reads inside; over the guest's memory → `OutOfMemory` |
| `read_to_string` | `read_to_string(&Place, P) -> Io<String>` | yes | owner only | not UTF-8 → `InvalidData` |
| `write` | `write(&Place, P, C: AsRef<[u8]>) -> Io<()>` | yes: one new object, atomic replace | yes: pushed to the host | over `limits.fs.max_file_bytes` → `FileTooLarge` |
| `copy` | `copy(&Place, P, &Place, Q) -> Io<u64>` | yes; same volume moves no bytes | owner only; re-stored | takes a place per path |
| `rename` | `rename(&Place, P, Q) -> Io<()>` | yes, one `Place` op | yes | one place: across places use `copy` then `remove_file` (`CrossesDevices` is what `vfs::move_across` reports) |
| `remove_file` | `remove_file(&Place, P) -> Io<()>` | to the Recycle Bin | to the Recycle Bin; the host may too | a directory → `IsADirectory` |
| `create_dir` | `create_dir(&Place, P) -> Io<()>` | yes | yes (a directory has no storage kind) | exists → `AlreadyExists` |
| `create_dir_all` | `create_dir_all(&Place, P) -> Io<()>` | yes | yes | |
| `remove_dir` | `remove_dir(&Place, P) -> Io<()>` | only if empty, else `DirectoryNotEmpty` | same | to the Recycle Bin |
| `remove_dir_all` | `remove_dir_all(&Place, P) -> Io<()>` | one `Remove` on the directory | same | its contents go and come back with it |
| `read_dir` | `read_dir(&Place, P) -> Io<ReadDir>` | yes | yes (names are visible to every member) | a snapshot, not a live cursor |
| `metadata` | `metadata(&Place, P) -> Io<Metadata>` | yes | yes; `len` is the plaintext length | |
| `symlink_metadata` | `symlink_metadata(&Place, P) -> Io<Metadata>` | as `metadata` | same | there are no links |
| `exists` | `exists(&Place, P) -> Io<bool>` | yes | yes | a removed entry does not exist |
| `canonicalize` | `canonicalize(&Place, P) -> Io<PathBuf>` | lexical, then checked to exist | same | never leaves the place |
| `set_permissions` | `set_permissions(&Place, P, Permissions) -> Io<()>` | `Chmod` | `Chmod` (never widens who can decrypt) | |
| `set_times`, `set_times_nofollow` | same names, `-> Io<()>` | `Unsupported` | `Unsupported` | times are the ops' own |
| `hard_link` | `hard_link(&Place, P, Q) -> Io<()>` | `Unsupported` | `Unsupported` | |
| `soft_link`, `read_link` | same names | `Unsupported` | `Unsupported` | there are no links |

### `File`

| `std::fs::File` | `sdk::fs::File` | S | R | Notes |
|---|---|---|---|---|
| `open` | `File::open(&Place, P) -> Io<File>` | yes | owner only | |
| `create` | `File::create(&Place, P) -> Io<File>` | yes | yes | |
| `create_new` | `File::create_new(&Place, P) -> Io<File>` | atomic where a server orders the volume; in a pair or group two offline creators both succeed and one is shown as `name (2)` | same | |
| `options` | `File::options() -> OpenOptions` | yes | yes | |
| `Read::read` | `read(&mut self, len: usize) -> Io<Vec<u8>>` | ranged | the object is fetched and decrypted once, then local | empty at end of file |
| `Read::read_to_end`, `read_to_string`, `read_exact` | `read_to_end(&mut self) -> Io<Vec<u8>>`, `read_to_string(&mut self) -> Io<String>`, `read_exact(&mut self, len: usize) -> Io<Vec<u8>>` | yes | owner only | `read_exact` short → `UnexpectedEof` |
| `Write::write`, `write_all` | `write(&mut self, buf: &[u8]) -> Io<usize>`, `write_all(&mut self, buf: &[u8]) -> Io<()>` | buffered until the commit | same | the bytes are copied before the call returns |
| `Write::flush` | `flush(&mut self) -> Io<()>` | the commit point | same | |
| `Seek::seek`, `rewind`, `stream_position` | `seek(&mut self, SeekFrom) -> Io<u64>`, `rewind`, `stream_position` | yes | yes | local to the descriptor |
| `sync_all`, `sync_data` | same names, `-> Io<()>` | the commit point: one new object, one op | same | |
| `set_len` | `set_len(&self, u64) -> Io<()>` | on the buffer, committed with it | same | |
| `metadata` | `metadata(&self) -> Io<Metadata>` | yes | yes | |
| `try_clone` | `try_clone(&self) -> Io<File>` | `Unsupported` | `Unsupported` | a descriptor is one cursor |
| `set_permissions` | `set_permissions(&self, Permissions) -> Io<()>` | `Chmod` | `Chmod` | |
| `set_times`, `set_modified` | same names | `Unsupported` | `Unsupported` | |
| `lock`, `lock_shared`, `unlock` | same names, `-> Io<()>` | `Unsupported` | `Unsupported` | |
| `try_lock`, `try_lock_shared` | same names, `-> Io<Result<(), TryLockError>>` | `Err(TryLockError::Error(Unsupported))` | same | `TryLockError` is `std`'s |
| drop | commits what was written if no commit ran, without reporting | same | same | call `sync_all` to see the outcome |

### `OpenOptions`, `DirBuilder`

| `std` | `sdk::fs` | Notes |
|---|---|---|
| `OpenOptions::new`, `read`, `write`, `append`, `truncate`, `create`, `create_new` | the same builders | `append` writes at the end of the buffer |
| `OpenOptions::open` | `open(&self, &Place, P) -> Io<File>` | flag combinations `std` refuses → `InvalidInput` |
| `DirBuilder::new`, `recursive` | the same | |
| `DirBuilder::create` | `create(&self, &Place, P) -> Io<()>` | |
| `os::unix::fs::DirBuilderExt::mode` | `fs::DirBuilderExt::mode(&mut self, u32)` | bits above `0o777` → `InvalidInput` at `create` |

### `Metadata`, `FileType`, `Permissions`, `FileTimes`, `DirEntry`, `ReadDir` (all synchronous: the data is already in hand)

| `std` | `sdk::fs` | Notes |
|---|---|---|
| `Metadata::file_type`, `is_dir`, `is_file`, `len`, `permissions` | the same | |
| `Metadata::is_symlink` | always `false` | |
| `Metadata::modified`, `created` | `io::Result<SystemTime>` | the author's clock of the winning op |
| `Metadata::accessed` | `Err(Unsupported)` | |
| `FileType::is_dir`, `is_file` | the same | |
| `FileType::is_symlink` | always `false` | |
| `Permissions::readonly` | no `w` for owner and members | |
| `Permissions::set_readonly` | clears / sets `w` for owner and members | |
| `os::unix::fs::PermissionsExt::{mode, set_mode, from_mode}` | `fs::PermissionsExt`, the same three | nine bits: owner / members / outsiders |
| `FileTimes::new`, `set_accessed`, `set_modified` | the same (so code compiles) | using one is `Unsupported` |
| `DirEntry::path`, `file_name` | `PathBuf` (relative to the place), `OsString` (the shown name) | |
| `DirEntry::metadata`, `file_type` | `io::Result<Metadata>`, `io::Result<FileType>` | no host call |
| `ReadDir` | `impl Iterator<Item = io::Result<DirEntry>>` | hidden (`.`-prefixed) entries included, as `std` |
| `os::unix::fs::chown` | `fs::chown(&Place, P, owner: u64) -> Io<()>` | `Chown`; the new owner is a member |
| `os::unix::fs::symlink` | `fs::symlink(..)` | `Unsupported` |

## 5. `sdk::vfs` (what `std::fs` has no words for)

```rust
use citadel_app_sdk::vfs::{self, Entry, State, Role, Pick, Event};

vfs::volumes() -> Io<Vec<Volume>>                                // the places this install may see, with members
vfs::entry(&Place, P) -> Io<Entry>                               // id, volume, name, mode, owner, state
impl Entry { pub fn state(&self) -> State; }                     // Shared | Revfs { role: Owner | Host | Other } | Removed
vfs::trash(&Entry) -> Io<()>      vfs::restore(&Entry) -> Io<()>      vfs::delete_forever(&Entry) -> Io<()>
vfs::recycle_bin(Option<&Place>) -> Io<Vec<Trashed>>             // entry, where it was, who removed it, when
vfs::chmod(&Entry, mode: u32) -> Io<()>      vfs::chown(&Entry, owner: u64) -> Io<()>
vfs::convert(&Entry, Storage) -> Io<()>                          // RE-VFS → Standard and back, explicit
vfs::move_across(&Place, P, &Place, Q) -> Io<()>                 // copy, then trash the source
vfs::watch(&Place, P) -> Io<Watch>                               // AppEvent::Vfs { watch, event }; dropped → unwatched
vfs::pick(Pick::file().extensions(&["ics"]).writable()) -> Io<Option<(Grant, Entry)>>
vfs::open_in_app(&Entry) -> Io<()>      vfs::applications() -> Io<Vec<AppLink>>      vfs::reveal(&Entry) -> Io<()>
vfs::admit(..), vfs::dismiss(..)                                 // reserved (pending OUTSIDERS-1124): `Unsupported`
```
`delete_forever` on a directory purges what is beneath it first (`vfs-ops.md` R9). Every call
is the op the File Manager would send for the same member.

## 6. Tests V6 owes

A fixture app (`apps/sdk-fixtures/`) with one case per row above, run on Standard and on RE-VFS
as owner and as host; each `Unsupported` row asserts its `ErrorKind`; an `.await` chain of three
calls completes across three `ReplyReady` events (control: do not wake the task → it never
completes → red); the error mapping table.
