# Contract: `authorize`, the one permission function — FROZEN 2026-11-24, revised round 2

Parties: V1 (the function), V2 (the kernel decides with it), V3/V4 (grey out and fail fast with
it), V6, V7 (outsiders), V8 (every group member decides with it at each position). Fixtures:
`fixtures/authorize/cases.json`. No cell below is open. Outsiders in full: `vfs-outsiders.md`.

## 1. The function

```rust
pub struct RoleMask { pub view: bool, pub upload: bool, pub download: bool,
                      pub manage_files: bool, pub share_links: bool }

pub struct VolumeCtx<'a> {
    pub kind: VolumeKind,                         // Personal | Pair | Node | Device | Group
    pub is_member: &'a dyn Fn(u64) -> bool,       // at the op's position (vfs-model §1)
    pub role: &'a dyn Fn(u64) -> RoleMask,
    pub retention_ms: u64,                        // vfs-model §7
    pub now_ms: u64,                              // the kernel's clock; elsewhere the op's own `at_ms`
}

pub fn authorize(tree: &Tree, ctx: &VolumeCtx, op: &Op) -> Result<(), Denied>;   // the op's author acts
pub fn may_list(tree: &Tree, ctx: &VolumeCtx, actor: &Principal, dir: InodeId) -> Result<(), Denied>;
pub fn may_read_bytes(tree: &Tree, ctx: &VolumeCtx, actor: &Principal, file: InodeId) -> Result<(), Denied>;

pub enum Denied {
    ServerOpKind, NoServerHere,
    Mode { need: Bit, at: InodeId },              // Bit = R | W | X; `at` is the entry that lacks it
    Role { need: RoleNeed },                      // RoleNeed = View | Upload | Download | ShareLinks
    NotOwner, OwnerNotAuthor, NewOwnerNotMember,
    NotAFile, NotRemoved, RevfsOwnerOnly, RevfsHost, HostCannotPurge,
    NotAdmitted, OutsiderNot, OwnerNotAdmitter, AdmissionCap(Cap),   // Cap = Bytes | Entries | Rate
    AlreadyMember, NoOutsidersHere, ClaimsExhausted, BadClaim,
}
```
`role`, by volume kind, for a member:

| Kind | `view` | `upload`, `download` | `manage_files` | `share_links` |
|---|---|---|---|---|
| Node | `ViewContent` on the node | `UploadFiles`, `DownloadFiles` on the node | `ManageFiles` on the node | `ShareSecureLinks` |
| Personal | true | `UploadFiles`, `DownloadFiles` on the workspace root (server storage, like any other) | false | `ShareSecureLinks` |
| Group | true | true | the member is the group's owner at this position | true |
| Pair, Device | true | true | false | true |

**What the bits do not hide.** Every member of a volume holds the volume's whole tree (names,
sizes, owners, modes): a volume has one log. Mode bits decide who may act and who is handed
bytes. (An outsider is served only its admitted subtree, `vfs-outsiders.md` §5.)

## 2. Actor classes and helper conditions

The class is taken against the entry being judged (column "judged on" in §4):

| Class | Is |
|---|---|
| **Server** | `author == Server` |
| **Administrator** | a member whose `role.manage_files` is true: Node (`ManageFiles` there) and Group (the group's owner). Personal, Pair and Device have none. |
| **Owner** | a member equal to the judged entry's `owner`. In a Pair volume both members are Owner of every entry. |
| **Member** | any other member |
| **Outsider** | anyone else: a `Member` principal for whom `is_member` is false, or a `LinkGuest`. It is **admitted** at entry `E` when `E` or an ancestor `A` has a live admission naming it (kind A: `[1, cid, …]`; a link guest: a claim applied for its `key_fp` under `[2, link_id, …]`), not expired at `ctx.now_ms`. `A` is its admission root for `E`. |

- `bit(actor, E, b)`: Administrator → yes. Owner → `E.mode` owner triple has `b`. Member →
  members triple. Admitted outsider → outsiders triple. In a Pair volume → yes for both members.
- `reach(actor, E)`: `bit(actor, A, X)` for every ancestor `A` of `E`, from the root down (for an
  outsider: from its admission root down, the root itself included when it is a folder above
  `E`); the first that fails is the `Mode { need: X, at: A }` answered.
- `dirw(actor, P)`: `reach(actor, P)`, then `bit(actor, P, W)`, then `bit(actor, P, X)`.
- `removal*(E)`: `E.removal` if set, else that of the nearest ancestor with one.

**Order of checks** (the first failure is the answer, so every implementation gives the same
refusal): (1) `Server` author: the kind (`NoServerHere`, `ServerOpKind`), then steps 5 and 7;
(2) an outsider: Device volume → `NoOutsidersHere`; not admitted at the judged entry (for
`Place`, at both parents under one admission root) → `NotAdmitted`; a kind outside `Create`,
`Place`, `SetPointee`, `Remove`, `Claim` → `OutsiderNot`; then steps 5 to 8; (3) members:
`role.view` (`Role { View }`); (4) for ✎ ops `role.upload` (`Role { Upload }`); (5) the target's
kind and state: `NotAFile`, `NotRemoved`; (6) the class and mode cell of §4 (`Mode`,
`NotOwner`); (7) the remaining rules of §3 in the order listed there; (8) an outsider's caps
(`AdmissionCap`).

## 3. Rules that hold in every volume kind

| Rule | Refusal |
|---|---|
| `Create.owner` is the author. Exceptions: in a Pair volume it may be either member; a `Server` op may name any member, or `Server`; an outsider's `Create` must name the member who admitted it (the admission's `by`) | `OwnerNotAuthor`; for an outsider `OwnerNotAdmitter` |
| `SetPointee` targets a `File` | `NotAFile` |
| A `Revfs` pointee is written (`Create`, `SetPointee`) only by its `owner`: `pointee.owner == author`; never by an outsider | `RevfsOwnerOnly` |
| An entry whose current pointee is `Revfs` has its pointee replaced only by that pointee's `owner` | `RevfsOwnerOnly` |
| A new `Revfs` pointee's `host`: `Server` in Personal and Node; the other member in Pair; a member other than `owner` in Group; never in Device | `RevfsHost` |
| The `host` of an entry's `Revfs` pointee may always `Remove` that entry | — |
| `Restore` targets an entry whose own `removal` is set | `NotRemoved` |
| `Purge` targets an entry in the `removed` state | `NotRemoved` |
| `Purge` of an entry whose pointee is `Revfs`, by anyone but `pointee.owner` (an administrator included): only if `removal*(E).by == pointee.owner`, or `op.at_ms >= removal*(E).at_ms + ctx.retention_ms` | `HostCannotPurge` |
| `Chown.owner` is a `Member` for whom `is_member` is true | `NewOwnerNotMember` |
| `Admit`, `Dismiss`: by whoever may `Chmod` the target (§4); never in a Device volume; an `Admit` of kind A names a non-member; a link (`Admit` or `Dismiss` of `[2, …]`) needs `role.share_links` | `NotOwner`; `NoOutsidersHere`; `AlreadyMember`; `Role { ShareLinks }` |
| `Claim`: only by a `LinkGuest` of that `link_id`, on an entry with a live admission for it, with claims left and a valid `link_sig` (`vfs-outsiders.md` §3) | `OutsiderNot` for anyone else; `NotAdmitted`, `ClaimsExhausted`, `BadClaim` |

## 4. The table

Cell = allowed (**yes**, with its condition) or the refusal. "§3" means "yes, subject to §3".
P = the target's parent; for `Place`, O = its current parent and N = the new one. ✎ marks the
ops that need `role.upload` in Node and Personal volumes.

### 4.0 The Outsider column (the same wherever outsiders are admitted)

| Op | An admitted outsider | Not admitted there |
|---|---|---|
| `Create` | yes if `dirw(P)` by the outsiders triple, §3 (`OwnerNotAdmitter`, no `Revfs`), within caps; else `Mode` / `AdmissionCap` | `NotAdmitted` |
| `Place` | yes if `dirw(O)` and `dirw(N)`, both under one admission root; else `Mode` | `NotAdmitted` |
| `SetPointee` | yes if `reach` and `bit(W)`, §3 (never a `Revfs`), within caps; else `Mode` / `AdmissionCap` | `NotAdmitted` |
| `Remove` | yes if `dirw(P)`; else `Mode` | `NotAdmitted` |
| `Restore`, `Purge`, `Chmod`, `Chown`, `Admit`, `Dismiss` | `OutsiderNot` | `NotAdmitted` |
| `Claim` | a link guest: yes, §3 (a first claim is judged against the link's admission, a handover against the guest's applied claim); kind A: `OutsiderNot` | `NotAdmitted` |

### 4.1 Node volume (`node:<id>`, Ordered; the kernel decides)

Every member op first needs `role.view`, else `Role { View }`; ✎ ops also need `role.upload`.
The Administrator needs no bit of the mode, but does need `role.view` (it is what makes them a
member).

| Op | Judged on | Owner | Member | Administrator | Outsider | Server |
|---|---|---|---|---|---|---|
| `Create` ✎ | P | yes if `dirw(P)`, §3; else `Mode` | yes if `dirw(P)`, §3; else `Mode` | yes, §3 | §4.0 | yes (seeded directories, app homes, migration); `owner` any member, or `Server` |
| `Place` ✎ | O and N | yes if `dirw(O)` and `dirw(N)`; else `Mode` | same | yes | §4.0 | `ServerOpKind` |
| `SetPointee` ✎ | target | yes if `reach` and `bit(W)`, §3; else `Mode` | same | yes, §3 (never a `Revfs` it does not own) | §4.0 | `ServerOpKind` |
| `Remove` ✎ | P | yes if `dirw(P)`; else `Mode` | same | yes | §4.0 | `ServerOpKind` |
| `Restore` ✎ | P | yes if `dirw(P)`, §3; else `Mode` | same | yes, §3 | §4.0 | `ServerOpKind` |
| `Purge` ✎ | target | yes, §3 | yes if `removal*(E).by` is the actor and `dirw(P)`, §3; else `NotOwner` | yes, §3 | §4.0 | yes if the target is `removed` (the kernel also requires retention to have passed) |
| `Chmod` | target | yes | `NotOwner` | yes | §4.0 | `ServerOpKind` |
| `Chown` | target | yes, §3 | `NotOwner` | yes, §3 | §4.0 | `ServerOpKind` |
| `Admit` | target | yes, §3 | `NotOwner` | yes, §3 | §4.0 | `ServerOpKind` |
| `Dismiss` | target | yes, §3 | `NotOwner` | yes, §3 | §4.0 | `ServerOpKind` |
| `Claim` | target | `OutsiderNot` | `OutsiderNot` | `OutsiderNot` | §4.0 | `ServerOpKind` |

### 4.2 Personal volume (`personal:<cid>`, Ordered; the kernel decides)

One member: the account, while it holds a role in the workspace and is not banned (otherwise
it is no member and the kernel answers `NoSuchVolume`). ✎ ops need `UploadFiles` on the
workspace root (`Role { Upload }`).

| Op | Judged on | Owner | Member | Administrator | Outsider | Server |
|---|---|---|---|---|---|---|
| `Create` ✎ | P | yes if `dirw(P)`, §3; else `Mode` | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | yes (seeded directories, app homes, migration); `owner` = the account |
| `Place` ✎ | O and N | yes if `dirw(O)` and `dirw(N)`; else `Mode` | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | `ServerOpKind` |
| `SetPointee` ✎ | target | yes if `reach` and `bit(W)`, §3; else `Mode` | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | `ServerOpKind` |
| `Remove` ✎ | P | yes if `dirw(P)`; else `Mode` | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | `ServerOpKind` |
| `Restore` ✎ | P | yes if `dirw(P)`, §3; else `Mode` | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | `ServerOpKind` |
| `Purge` ✎ | target | yes, §3 | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | yes if the target is `removed` (the kernel also requires retention to have passed) |
| `Chmod` | target | yes | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | `ServerOpKind` |
| `Chown` | target | `NewOwnerNotMember` unless to itself | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | `ServerOpKind` |
| `Admit` | target | yes, §3 | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | `ServerOpKind` |
| `Dismiss` | target | yes, §3 | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | `ServerOpKind` |
| `Claim` | target | `OutsiderNot` | cannot occur (one member, who owns every entry); defined as the Group cell | no such class here | §4.0 | `ServerOpKind` |

### 4.3 Pair volume (`pair:<lo>:<hi>`, Merge; each member's replica decides in the fold)

Both members are Owner of every entry and the mode is not consulted for them: its first two
triples are unused there and its third is the outsiders' policy. No ✎ requirement.

| Op | Judged on | Owner | Member | Administrator | Outsider | Server |
|---|---|---|---|---|---|---|
| `Create` ✎ | P | yes, §3 | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |
| `Place` ✎ | O and N | yes | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |
| `SetPointee` ✎ | target | yes, §3 | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |
| `Remove` ✎ | P | yes | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |
| `Restore` ✎ | P | yes, §3 | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |
| `Purge` ✎ | target | yes, §3 (`HostCannotPurge` applies) | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |
| `Chmod` | target | yes | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |
| `Chown` | target | yes, §3 | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |
| `Admit` | target | yes, §3 | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |
| `Dismiss` | target | yes, §3 | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |
| `Claim` | target | `OutsiderNot` | no such class here | no such class here | §4.0 (positions are stamps; `Dismiss.lasts` cuts, `vfs-outsiders.md` §2) | `NoServerHere` |

### 4.4 Device volume (`device:<cid>`, one replica)

No ✎ requirement. Nobody is admitted here.

| Op | Judged on | Owner | Member | Administrator | Outsider | Server |
|---|---|---|---|---|---|---|
| `Create` ✎ | P | yes if `dirw(P)`, §3 (`Revfs` → `RevfsHost`); else `Mode` | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |
| `Place` ✎ | O and N | yes if `dirw(O)` and `dirw(N)`; else `Mode` | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |
| `SetPointee` ✎ | target | yes if `reach` and `bit(W)`, §3; else `Mode` | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |
| `Remove` ✎ | P | yes if `dirw(P)`; else `Mode` | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |
| `Restore` ✎ | P | yes if `dirw(P)`, §3; else `Mode` | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |
| `Purge` ✎ | target | yes, §3 | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |
| `Chmod` | target | yes | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |
| `Chown` | target | `NewOwnerNotMember` unless to itself | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |
| `Admit` | target | `NoOutsidersHere` | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |
| `Dismiss` | target | `NoOutsidersHere` | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |
| `Claim` | target | `OutsiderNot` | no such class here | no such class here | `NoOutsidersHere` | `NoServerHere` |

### 4.5 Group volume (`group:<creator>:<mgid>`, Ordered; every member decides at the op's position)

The member set and the Administrator (the group's owner) are those of the op's position
(`vfs-group.md` §2). No ✎ requirement. A refusal here is a skip that every member makes alike.

| Op | Judged on | Owner | Member | Administrator | Outsider | Server |
|---|---|---|---|---|---|---|
| `Create` ✎ | P | yes if `dirw(P)`, §3; else `Mode` | yes if `dirw(P)`, §3; else `Mode` | yes, §3 | §4.0 | `NoServerHere` |
| `Place` ✎ | O and N | yes if `dirw(O)` and `dirw(N)`; else `Mode` | same | yes | §4.0 | `NoServerHere` |
| `SetPointee` ✎ | target | yes if `reach` and `bit(W)`, §3; else `Mode` | same | yes, §3 (never a `Revfs` it does not own) | §4.0 | `NoServerHere` |
| `Remove` ✎ | P | yes if `dirw(P)`; else `Mode` | same | yes | §4.0 | `NoServerHere` |
| `Restore` ✎ | P | yes if `dirw(P)`, §3; else `Mode` | same | yes, §3 | §4.0 | `NoServerHere` |
| `Purge` ✎ | target | yes, §3 | yes if `removal*(E).by` is the actor and `dirw(P)`, §3; else `NotOwner` | yes, §3 | §4.0 | `NoServerHere` |
| `Chmod` | target | yes | `NotOwner` | yes | §4.0 | `NoServerHere` |
| `Chown` | target | yes, §3 | `NotOwner` | yes, §3 | §4.0 | `NoServerHere` |
| `Admit` | target | yes, §3 | `NotOwner` | yes, §3 | §4.0 | `NoServerHere` |
| `Dismiss` | target | yes, §3 | `NotOwner` | yes, §3 | §4.0 | `NoServerHere` |
| `Claim` | target | `OutsiderNot` | `OutsiderNot` | `OutsiderNot` | §4.0 | `NoServerHere` |

## 5. Reading

| Action | Needs | Refusal |
|---|---|---|
| List a directory (`may_list`) | member; `role.view`; `reach(dir)`; `bit(dir, R)` | `Role { View }`, `Mode` |
| Metadata of an entry | member; `role.view`; `reach(entry)` | `Role { View }`, `Mode` |
| Read a file's bytes (`may_read_bytes`) | in this order: member; `role.view`; `reach(file)`; `bit(file, R)`; `role.download`; a `Revfs` pointee: the actor is `pointee.owner` | `Role { View }`, `Mode`, `Role { Download }`, `RevfsOwnerOnly` |
| Open a `LiveDoc` | as reading bytes; editing it needs `bit(file, W)` and `role.upload` | as above |
| Any of these, by an outsider | admitted at the entry (else `NotAdmitted`); the entry and every folder from the admission root down to it are not removed (else `NotAdmitted`); then `reach` and `bit` by the outsiders triple; never a `Revfs` file; no role is consulted | `NotAdmitted`, `Mode`, `RevfsOwnerOnly` |

The kernel runs the read checks against its own tree at the time of each chunk; a member's
device serving an outsider does the same against its replica.

## 6. Workspace permissions (`citadel_workspace_types::structs::Permission`)

| Permission | Role in the VFS |
|---|---|
| `ViewContent` on a node | membership of `node:<id>`; `role.view` |
| `UploadFiles` on a node / on the workspace root | `role.upload` in that Node volume / in every Personal volume: every ✎ op and editing a `LiveDoc` |
| `DownloadFiles` on a node / on the workspace root | `role.download`: being handed a file's bytes |
| `ManageFiles` on a node (**new**) | volume administrator there. On the workspace root also: set `vfs_retention_days` and `vfs_browser_links` |
| `ShareSecureLinks` | `role.share_links`: admitting or dismissing by link in a Personal or Node volume, and making the link (`LinkGrant::VfsEntry`) |

`ManageFiles` is appended as the last variant of `Permission` (after
`AppInstallAllowGroupTopics`; `ALL_VARIANTS` becomes `[Permission; 53]`), is grantable on a node
like `UploadFiles`, is held by Owner (and by Admin through `All`), and by neither Member nor
Guest seeds. `bindings/seed_roles.json`, `permission-constants.ts` and
`permissions-service/types.ts` gain it in the same change (the parity gate holds them equal).

## 7. Tests V1, V2 and V8 owe

Every case of `fixtures/authorize/cases.json` on both targets; one generated test per cell of §4
(control per row: answer `Ok` for the Member column → the `NotOwner` cases go red); the kernel
never reads a mode, an owner or a membership from a request (control: trust the request's
`owner` → a `Create` naming another member as owner is admitted → red); an outsider's op
outside its admission root is refused wherever it is judged (control: judge by the outsiders
triple alone → red).
