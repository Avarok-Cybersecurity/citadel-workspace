# Contract: `authorize`, the one permission function — FROZEN 2026-11-24

Parties: V1 (the function), V2 (the kernel decides with it), V3/V4 (grey out and fail fast with
it), V6 (the kernel's `fs` arm), V8 (folded with it). Fixtures: `fixtures/authorize/cases.json`.
No cell below is open: where the owner has not decided, the cell says so and the answer is a
refusal.

## 1. The function

```rust
pub struct RoleMask { pub view: bool, pub upload: bool, pub download: bool, pub manage_files: bool }

pub struct VolumeCtx<'a> {
    pub kind: VolumeKind,                         // Personal | Pair | Node | Device | Group
    pub is_member: &'a dyn Fn(u64) -> bool,       // derived membership (vfs-model §1)
    pub role: &'a dyn Fn(u64) -> RoleMask,        // Node: from the kernel's role table at the node
    pub retention_ms: u64,                        // vfs-model §7
}

pub fn authorize(tree: &Tree, ctx: &VolumeCtx, op: &Op) -> Result<(), Denied>;   // the op's author acts
pub fn may_list(tree: &Tree, ctx: &VolumeCtx, actor: &Principal, dir: InodeId) -> Result<(), Denied>;
pub fn may_read_bytes(tree: &Tree, ctx: &VolumeCtx, actor: &Principal, file: InodeId) -> Result<(), Denied>;

pub enum Denied {
    OutsidersPending, ServerOpKind, NoServerHere,
    Mode { need: Bit, at: InodeId },              // Bit = R | W | X; `at` is the entry that lacks it
    Role { need: RoleNeed },                      // RoleNeed = View | Upload | Download
    NotOwner, OwnerNotAuthor, NewOwnerNotMember,
    NotAFile, NotRemoved, RevfsOwnerOnly, RevfsHost, HostCannotPurge,
}
```
Outside Node volumes `role` answers `{ view: true, upload: true, download: true, manage_files:
false }` for a member: workspace roles bound Node volumes only.

**What the bits do not hide.** Every member of a volume holds the volume's whole tree (names,
sizes, owners, modes): the tree is the same for all of them. Mode bits decide who may act and
who is handed bytes.

## 2. Actor classes and helper conditions

The class is taken against the entry being judged (column "judged on" in §4):

| Class | Is |
|---|---|
| **Server** | `author == Server` |
| **Outsider** | an `Outsider` principal, or a `Member` for whom `is_member` is false |
| **Administrator** | Node volumes only: a member whose `role.manage_files` is true (`Permission::ManageFiles` at that node). No other volume kind has one. |
| **Owner** | a member equal to the judged entry's `owner`. In a Pair volume both members are Owner of every entry. |
| **Member** | any other member |

- `bit(actor, E, b)`: Administrator → yes. Owner → `E.mode` owner triple has `b`. Member →
  members triple has `b`. In a Pair volume → yes for both members.
- `reach(actor, E)`: `bit(actor, A, X)` for every ancestor `A` of `E`, from the root down; the
  first that fails is the `Mode { need: X, at: A }` answered.
- `dirw(actor, P)`: `reach(actor, P)`, then `bit(actor, P, W)`, then `bit(actor, P, X)`.
- `removal*(E)`: `E.removal` if set, else that of the nearest ancestor with one.

**Order of checks** (the first failure is the answer, so every implementation gives the same
refusal): (1) `Server` author: the kind (`NoServerHere`, `ServerOpKind`), then step 5 and 7;
(2) Outsider → `OutsidersPending`; (3) kinds `Admit`, `Dismiss`, `Claim` → `OutsidersPending`;
(4) Node volumes: `role.view` (`Role { View }`), then for ✎ ops `role.upload`
(`Role { Upload }`); (5) the target's kind and state: `NotAFile`, `NotRemoved`; (6) the class
and mode cell of §4 (`Mode`, `NotOwner`); (7) the remaining rules of §3 in the order listed
there.

## 3. Rules that hold in every volume kind, for Owner, Member and Administrator alike

| Rule | Refusal |
|---|---|
| `Create.owner` is the author. Exceptions: in a Pair volume it may be either member; a `Server` op may name any member, or `Server` | `OwnerNotAuthor` |
| `SetPointee` targets a `File` | `NotAFile` |
| A `Revfs` pointee is written (`Create`, `SetPointee`) only by its `owner`: `pointee.owner == author` | `RevfsOwnerOnly` |
| An entry whose current pointee is `Revfs` has its pointee replaced only by that pointee's `owner` | `RevfsOwnerOnly` |
| A new `Revfs` pointee's `host`: `Server` in Personal and Node; the other member in Pair; a member other than `owner` in Group; never in Device | `RevfsHost` |
| The `host` of an entry's `Revfs` pointee may always `Remove` that entry | — |
| `Restore` targets an entry whose own `removal` is set | `NotRemoved` |
| `Purge` targets an entry in the `removed` state | `NotRemoved` |
| `Purge` of an entry whose pointee is `Revfs`, by anyone but `pointee.owner`: only if `removal*(E).by == pointee.owner`, or `op.at_ms >= removal*(E).at_ms + ctx.retention_ms` | `HostCannotPurge` |
| `Chown.owner` is a `Member` for whom `is_member` is true | `NewOwnerNotMember` |
| `Admit`, `Dismiss`, `Claim` | `OutsidersPending` (pending OUTSIDERS-1124) |

## 4. The table

Cell = allowed (**yes**, with its condition) or the refusal. "§3" means "yes, subject to §3".
P = the target's parent; for `Place`, O = its current parent and N = the new one.

### 4.1 Node volume (`node:<id>`, Ordered; the kernel decides)

Every member op first needs `role.view`, else `Role { View }`; ops marked ✎ also need
`role.upload`, else `Role { Upload }`. The Administrator needs neither bit of the mode, but does
need `role.view` (it is what makes them a member).

| Op | Judged on | Owner | Member | Administrator | Outsider | Server |
|---|---|---|---|---|---|---|
| `Create` ✎ | P | yes if `dirw(P)`, §3; else `Mode` | yes if `dirw(P)`, §3; else `Mode` | yes, §3 | `OutsidersPending` | yes (seeded directories, app homes, migration); `owner` any member |
| `Place` ✎ | O and N | yes if `dirw(O)` and `dirw(N)`; else `Mode` | same | yes | `OutsidersPending` | `ServerOpKind` |
| `SetPointee` ✎ | target | yes if `reach` and `bit(W)`, §3; else `Mode` | same | yes, §3 (never a `Revfs` it does not own) | `OutsidersPending` | `ServerOpKind` |
| `Remove` ✎ | P | yes if `dirw(P)`; else `Mode` | same | yes | `OutsidersPending` | `ServerOpKind` |
| `Restore` ✎ | P | yes if `dirw(P)`, §3; else `Mode` | same | yes, §3 | `OutsidersPending` | `ServerOpKind` |
| `Purge` ✎ | target | yes, §3 | yes if `removal*(E).by` is the actor and `dirw(P)`, §3; else `NotOwner` | yes, §3 | `OutsidersPending` | yes if the target is `removed` (the kernel also requires retention to have passed) |
| `Chmod` | target | yes | `NotOwner` | yes | `OutsidersPending` | `ServerOpKind` |
| `Chown` | target | yes, §3 | `NotOwner` | yes, §3 | `OutsidersPending` | `ServerOpKind` |
| `Admit` | target | `OutsidersPending` | `OutsidersPending` | `OutsidersPending` | `OutsidersPending` | `OutsidersPending` |
| `Dismiss` | target | `OutsidersPending` | `OutsidersPending` | `OutsidersPending` | `OutsidersPending` | `OutsidersPending` |
| `Claim` | target | `OutsidersPending` | `OutsidersPending` | `OutsidersPending` | `OutsidersPending` | `OutsidersPending` |

### 4.2 Personal volume (`personal:<cid>`, Ordered; the kernel decides)

One member: the account, while it holds a role in the workspace and is not banned (otherwise
it is no member and the kernel answers `NoSuchVolume`). No workspace permission is consulted
beyond that.

| Op | Judged on | Owner | Member | Administrator | Outsider | Server |
|---|---|---|---|---|---|---|
| `Create` | P | yes if `dirw(P)`, §3; else `Mode` | cannot occur (one member, who owns every entry); defined as the Owner cell with the members triple | no such class here | `OutsidersPending` | yes (seeded directories, app homes); `owner` = the account |
| `Place` | O and N | yes if `dirw(O)` and `dirw(N)`; else `Mode` | as above | no such class | `OutsidersPending` | `ServerOpKind` |
| `SetPointee` | target | yes if `reach` and `bit(W)`, §3; else `Mode` | as above | no such class | `OutsidersPending` | `ServerOpKind` |
| `Remove` | P | yes if `dirw(P)`; else `Mode` | as above | no such class | `OutsidersPending` | `ServerOpKind` |
| `Restore` | P | yes if `dirw(P)`, §3; else `Mode` | as above | no such class | `OutsidersPending` | `ServerOpKind` |
| `Purge` | target | yes, §3 | `NotOwner` unless it removed it and `dirw(P)` | no such class | `OutsidersPending` | yes if the target is `removed` (retention, kernel) |
| `Chmod` | target | yes | `NotOwner` | no such class | `OutsidersPending` | `ServerOpKind` |
| `Chown` | target | `NewOwnerNotMember` unless to itself | `NotOwner` | no such class | `OutsidersPending` | `ServerOpKind` |
| `Admit`, `Dismiss`, `Claim` | target | `OutsidersPending` | `OutsidersPending` | no such class | `OutsidersPending` | `OutsidersPending` |

### 4.3 Pair volume (`pair:<lo>:<hi>`, Merge; each member's replica decides in the fold)

Both members are Owner of every entry and the mode is not consulted for them (it is the policy
for outsiders only).

| Op | Judged on | Owner (either member) | Member | Administrator | Outsider | Server |
|---|---|---|---|---|---|---|
| `Create` | P | yes, §3 | no such class here | no such class | `OutsidersPending` | `NoServerHere` |
| `Place` | O and N | yes | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `SetPointee` | target | yes, §3 | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Remove` | P | yes | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Restore` | P | yes, §3 | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Purge` | target | yes, §3 (`HostCannotPurge` applies) | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Chmod` | target | yes | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Chown` | target | yes, §3 | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Admit`, `Dismiss`, `Claim` | target | `OutsidersPending` | no such class | no such class | `OutsidersPending` | `NoServerHere` |

### 4.4 Device volume (`device:<cid>`, one replica)

| Op | Judged on | Owner (the account) | Member | Administrator | Outsider | Server |
|---|---|---|---|---|---|---|
| `Create` | P | yes if `dirw(P)`, §3 (`Revfs` → `RevfsHost`); else `Mode` | no such class here | no such class | `OutsidersPending` | `NoServerHere` |
| `Place` | O and N | yes if `dirw(O)` and `dirw(N)`; else `Mode` | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `SetPointee` | target | yes if `reach` and `bit(W)`, §3; else `Mode` | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Remove` | P | yes if `dirw(P)`; else `Mode` | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Restore` | P | yes if `dirw(P)`, §3; else `Mode` | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Purge` | target | yes, §3 | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Chmod` | target | yes | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Chown` | target | `NewOwnerNotMember` unless to itself | no such class | no such class | `OutsidersPending` | `NoServerHere` |
| `Admit`, `Dismiss`, `Claim` | target | `OutsidersPending` | no such class | no such class | `OutsidersPending` | `NoServerHere` |

### 4.5 Group volume (`group:<creator>:<mgid>`, Merge; every member's replica decides in the fold)

| Op | Judged on | Owner | Member | Administrator | Outsider | Server |
|---|---|---|---|---|---|---|
| `Create` | P | yes if `dirw(P)`, §3; else `Mode` | same | no such class here | `OutsidersPending` | `NoServerHere` |
| `Place` | O and N | yes if `dirw(O)` and `dirw(N)`; else `Mode` | same | no such class | `OutsidersPending` | `NoServerHere` |
| `SetPointee` | target | yes if `reach` and `bit(W)`, §3; else `Mode` | same | no such class | `OutsidersPending` | `NoServerHere` |
| `Remove` | P | yes if `dirw(P)`; else `Mode` | same | no such class | `OutsidersPending` | `NoServerHere` |
| `Restore` | P | yes if `dirw(P)`, §3; else `Mode` | same | no such class | `OutsidersPending` | `NoServerHere` |
| `Purge` | target | yes, §3 | yes if `removal*(E).by` is the actor and `dirw(P)`, §3; else `NotOwner` | no such class | `OutsidersPending` | `NoServerHere` |
| `Chmod` | target | yes | `NotOwner` | no such class | `OutsidersPending` | `NoServerHere` |
| `Chown` | target | yes, §3 | `NotOwner` | no such class | `OutsidersPending` | `NoServerHere` |
| `Admit`, `Dismiss`, `Claim` | target | `OutsidersPending` | `OutsidersPending` | no such class | `OutsidersPending` | `NoServerHere` |

In a Group volume `is_member` is true for every author whose op the replica holds: membership
was established when the op was carried (`vfs-ops.md` §4, ingestion), so a member who has left
keeps authorship of what they wrote and can write nothing new.

## 5. Reading

| Action | Needs | Refusal |
|---|---|---|
| List a directory (`may_list`) | member; Node: `role.view`; `reach(dir)`; `bit(dir, R)` | `Role { View }`, `Mode` |
| Metadata of an entry | member; Node: `role.view`; `reach(entry)` | `Role { View }`, `Mode` |
| Read a file's bytes (`may_read_bytes`) | in this order: member; Node: `role.view`; `reach(file)`; `bit(file, R)`; Node: `role.download`; a `Revfs` pointee: the actor is `pointee.owner` | `Role { View }`, `Mode`, `Role { Download }`, `RevfsOwnerOnly` |
| Open a `LiveDoc` | as reading bytes; editing it needs `bit(file, W)` (Node: `role.upload`) | as above |
| Anything, by an Outsider (anyone who is not a member) | — | `OutsidersPending` |

The kernel runs the read checks against its own tree at the time of each chunk.

## 6. Workspace permissions (`citadel_workspace_types::structs::Permission`)

| Permission | Role in the VFS |
|---|---|
| `ViewContent` on a node | membership of `node:<id>`; `role.view` (`r`, `x`) |
| `UploadFiles` on a node | `role.upload`: every ✎ op and editing a `LiveDoc` |
| `DownloadFiles` on a node | `role.download`: being handed a file's bytes |
| `ManageFiles` on a node (**new**) | `role.manage_files`: volume administrator there. On the workspace root also: set `vfs_retention_days` |
| `ShareSecureLinks` | reserved for admitting by link (pending OUTSIDERS-1124); consulted by nothing in this release |

`ManageFiles` is appended as the last variant of `Permission` (after
`AppInstallAllowGroupTopics`; `ALL_VARIANTS` becomes `[Permission; 53]`), is grantable on a node
like `UploadFiles`, is held by Owner (and by Admin through `All`), and by neither Member nor
Guest seeds. `bindings/seed_roles.json`, `permission-constants.ts` and
`permissions-service/types.ts` gain it in the same change (the parity gate holds them equal).

## 7. Tests V1 and V2 owe

Every case of `fixtures/authorize/cases.json` on both targets; one generated test per cell of §4
(control per row: answer `Ok` for the Member column → the `NotOwner` cases go red); the kernel
never reads a mode, an owner or a membership from a request (control: trust the request's
`owner` → a `Create` naming another member as owner is admitted → red).
