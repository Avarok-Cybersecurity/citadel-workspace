# Contract: the File Manager on volumes (links, badges, behaviour, words) — FROZEN 2026-11-24, revised round 2

Parties: V4 (File Manager), V5 (chat documents and files, "Navigate to Folder"), V3 (the
replica the UI reads). Model: `vfs-model.md` §8, §9. Geometry assertions follow the repository's
rule for UI changes: Chromium and WebKit, 390 and 1280 wide, light and dark.

## 1. Deep links (`citadel-workspaces/src/lib/file-manager-location.ts`)

```
/workspace?section=files[&volume=<where>][&path=/a/b][&item=<shown name>]
<where> = a volume id (vfs-model §1)  |  applications  |  bin  |  shared
```
- No `volume` (and no legacy key): the File Manager's root (`vfs-model.md` §9).
- `path` is `/`-separated shown names from the volume's root, normalised as today
  (`normalizePath`); absent means `/`. `item` selects and scrolls to one entry of that folder.
- A `volume` that is not one of the forms above, or names a volume the viewer is not in, stays
  **unreadable**: the screen says so, and never opens some other place.
- Writers (`fileManagerHref`, `fileManagerLink`) write `volume`, `path`, `item` and nothing
  else. `peer_id` and `via` are never written again.

**Legacy links keep resolving** (read side only; `me` is the viewer's cid):

| Link carries | Resolves to |
|---|---|
| `peer_id=server`, or no `peer_id` with a `path` other than `/` | `personal:<me>` at `path` |
| `peer_id=<cid>`, `cid != me` | `pair:<min(me,cid)>:<max(me,cid)>` at `path` |
| `peer_id=<me>&via=<cid>` (a peer link opened by that peer) | the pair with `via` |
| `peer_id=<me>` without `via`, or `peer_id` that is neither `server` nor a non-zero decimal | unreadable, as today |
| `path` under `/Received Files` | the same path under `/Transfers` |
| `path` under `/Sent Files` | `/Transfers` (the folder; `item` kept) |

```ts
export type FileManagerPlace =
  | { kind: 'root' } | { kind: 'applications' } | { kind: 'bin' } | { kind: 'shared' }
  | { kind: 'volume'; id: string }
  | { kind: 'invalid'; raw: string };
export interface FileManagerLocation { place: FileManagerPlace; path: string; item: string | null }
```

## 2. "Navigate to Folder"

The label is exactly **Navigate to Folder**. It appears in the right-click (and long-press)
menu of a document card and of a file card in any chat, and in the `⋯` menu of the banner an
open document shows. It routes to `fileManagerHref({ place: { kind: 'volume', id }, path:
<the entry's parent, by shown names>, item: <the entry's shown name> })`, computed from the tree
when it is chosen (an entry is followed by id, wherever it was moved):

| The card is | Volume | Entry id (derived, `vfs-model.md` §2) |
|---|---|---|
| a document in the scratchpad | `device:<me>` | `chat-doc`, the document id |
| a document in a direct chat | the pair's | `chat-doc`, the document id |
| a document in a node's chat | `node:<node_id>` | `chat-doc`, the document id |
| a document in a peer group | the group's | `chat-doc`, the document id |
| a file shared in a node's chat | `node:<node_id>` | `chat-file`, the attachment id |
| a file sent in a direct chat | the pair's | `transfer`, the transfer id |
| a file shared in a peer group | the group's | `chat-file`, the file's SHA-256 (hex) |

Such an entry is created, with that id, by whoever shares or receives the item first (a
document: under `/Documents`; a node or group file: `/Chat files`; a direct transfer:
`/Transfers`); a second creator's op merges. If the entry is in the Recycle Bin the link opens
the bin with it selected. If it does not exist (purged, or not synced yet) the menu item is
shown disabled with "Not in Files" as its description; it never opens another folder.

## 3. Tile badges

Derived per viewer from the entry's pointee, never stored:

| Condition | Badge | `data-testid` | Accessible name | On open |
|---|---|---|---|---|
| pointee is `Revfs` and `me == pointee.owner` | green shield | `vfs-badge-owner` | "Encrypted. Only you can open it." | open / download / edit / view |
| pointee is `Revfs` and `me` is `pointee.host` | golden lock | `vfs-badge-host` | "You store this for <owner>. You cannot open it." | the storage panel (§5), never content |
| pointee is `Revfs`, neither | grey lock | `vfs-badge-other` | "Encrypted for <owner>." | nothing opens; Properties only |
| anything else | none | — | — | the file's opener |

The three differ in shape as well as colour, are drawn from theme tokens, and hold a 3:1
contrast against the tile in both themes. The badge sits inside the tile's own box in list and
grid layouts at both widths (asserted against the tile's rectangle, not the viewport). A name
starting with `.` is hidden unless "Show hidden items" is on.

## 4. Desktop behaviours committed for this release (each is one assertion or more)

Pointer and keyboard:
- [ ] single click selects; double click or Enter opens
- [ ] F2 renames in place; Enter commits, Escape cancels, an invalid or colliding name is said
      beside the field and nothing is sent
- [ ] Delete moves the selection to the Recycle Bin; Shift+Delete asks, then deletes forever
- [ ] Ctrl/Cmd+C, X, V copy, cut and paste within and across volumes; pasting in place names
      the copy `name (2)`
- [ ] drag and drop moves; with the platform's copy modifier it copies; the drop target is
      outlined and a refused target shows the not-allowed cursor
- [ ] a marquee selects what it touches; Shift extends a range; Ctrl/Cmd toggles one
- [ ] typing finds the next item whose name starts with what was typed
- [ ] Ctrl/Cmd+Z undoes the last move, rename or delete (one step)
- [ ] on a name collision when moving or copying: "Replace", "Keep both", "Skip"

Layout:
- [ ] list and grid views; the choice is remembered per viewer
- [ ] sortable columns: name, size, kind, modified, owner; the sorted column is marked
- [ ] breadcrumbs, whose path can be edited as text; back and forward
- [ ] a details pane: kind, size, owner, mode in plain words ("Members can: view, change"),
      storage ("Shared" / "Encrypted, stored with <name>"), where it is stored, created, modified
- [ ] Properties: owner (Chown, to a member), two rows of toggles (Owner, Members) with plain
      words, and a third row, "People outside", shown with the list of who is admitted
      ("Outside access", §7)
- [ ] `/Applications` tiles open the app; their Properties link to the install's scope

Touch (390 wide):
- [ ] long press opens the menu; a selection mode with a visible count
- [ ] every control is at least 44 px in both dimensions, measured in px

Recycle Bin:
- [ ] every removed entry of every volume the viewer is in, with "Deleted by <name>, from
      <path>" and when
- [ ] "Restore" and "Delete Forever" per item and for a selection; a refusal says which right
      is missing
- [ ] "Delete Forever" on a folder says how many items go with it

## 5. Words for RE-VFS

| Where | Words |
|---|---|
| The owner chooses RE-VFS storage with a peer | "<Peer> will store this for you. <Peer> can see its name and size, not its contents." |
| The owner chooses RE-VFS storage on the server | "The server will store this for you. It can see the file's name and size, not its contents." |
| The host opens the tile (storage panel title) | "You store this file for <owner>" |
| Storage panel body | "You can see its name and size, not its contents. Only <owner> can open it." with size, date, how much of your storage it uses |
| Host's "Remove" | "Move to Recycle Bin. <Owner> will be told and has <n> days to move it elsewhere." |
| Host's "Delete Forever" while not allowed | "You can delete this for good after <date>, or once <owner> removes it." |
| "Share" on an RE-VFS file | "Only you can open this file. To share it, make it a shared file first." with the action "Make this a shared file" |
| A third member's Properties | "Encrypted for <owner>. Only <owner> can open it." |
| A Standard file's bytes are with nobody online (pair, group) | "No one who has this file is online" |
| A member who can never be reached again owns an RE-VFS file (administrators) | "Only <name> can ever open this" |

## 6. Words for a volume's verification state (`vfs-signing.md` §5)

| State | Where | Words |
|---|---|---|
| `Unpinned` | banner on the volume | "This device has not checked who wrote these changes. Create your Citadel identity to check, and to change files." |
| `NeedsIdentity` | in place of the refused action | "Create your Citadel identity to change files here." with the action that opens Settings → Security |
| `Locked` | prompt | "Unlock your Citadel identity to save this change." |
| `KeyChanged` | the whole volume pane, not a toast | "<name> is signing with a different key than before." with "Compare", "Accept the new key", "Not now" |
| `Unverified` | the whole volume pane, not a toast | "Some changes here could not be checked, so they are not shown." with what failed, the last checked change's time and "Try again" |
| `UpdateNeeded` | banner | "Update Citadel to see the newest changes here." |

Every such notice is in the page flow (it never covers the list it describes).

## 7. Everyone in a place sees its names; people outside it see only what they were let into

| Where | Words |
|---|---|
| Properties, under the "Members" row | "Everyone in <place> can see the names of all files and folders here. These settings decide who can open and change them." |
| Turning off "view" for members on a folder | "Members will still see this folder's name and what is in it by name. They will not be able to open the files." |
| Invite dialog, title | "Share <name> with someone outside <place>" |
| Invite dialog, choices | "A member of this workspace" (pick) / "Anyone with the link who has Citadel" (how many people, 1 to 50) / "Anyone with the link can download" (shown only where the workspace allows it and the item is not encrypted storage) |
| Invite dialog, rights | "Can view" / "Can view and change"; then "Until" (a date, at most 30 days for a link) and "Limits" (space, number of items, changes a minute) |
| Invite dialog, footnote | "They will see only this item and what is inside it. Ending access stops the next download; it cannot take back what was already downloaded." |
| A link, once made | "Copy this link now. It is shown once." |
| In a pair or group, link to a browser | "People without Citadel can only download from the server. Copy to My files and share from there? The server will then hold this file." |
| An outsider, nobody online (pair, group) | "No one who can share this is online" |
| Properties → "Outside access" | one row per admission: who (or "Link, 2 of 5 used"), by whom, what they may do, until when, limits used, downloads (count and last time), "End access" |
| An outsider's own view, header | "<owner> shared this with you" and, for a link guest, "Keep this access: create your identity" |
| The download page (nothing installed) | the item's name and size, "<name> shared this with you", "Download", "Get Citadel to do more" |

An outsider's File Manager shows one item under `/Shared with me` per admission, never a
Recycle Bin for it, never `/Applications` entries for it, and names of people only as authors
of what it can see.

## 8. Tests V4, V5 and V7 owe

`check:ui-sweep` scenarios for the root, a pair volume with all three badges, the Recycle Bin,
Properties and each state of §6; one geometry assertion per box of §4; the legacy-link table of
§1 as a pure table test (control: resolve `peer_id=<me>` without `via` to a pair → red); a chat
document's and a chat file's "Navigate to Folder" land on the folder with the item selected
(control: link to `/Documents` by name after the entry was moved → red).
