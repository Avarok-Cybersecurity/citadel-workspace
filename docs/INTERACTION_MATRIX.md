# Citadel Workspaces — Exhaustive Interaction Matrix

> Every possible navigation path, feature access combination, and state transition.
> Use this as a permanent testing and development reference.

---

## 1. Navigation Transition Matrix (Page → Page)

Every cell = a concrete user path that MUST work correctly.

| FROM ↓ \ TO → | Landing `/` | Connect `/connect` | Workspace `/workspace` | Messages `/messages` | Directory `/directory` | Groups `/groups/:id` | NotFound `/*` |
|---|---|---|---|---|---|---|---|
| **Landing** | — | "Go to Connect" btn | Login→success / Join→success / Orphan icon click | ✗ (no direct link) | ✗ (no direct link) | ✗ (no direct link) | Type invalid URL |
| **Connect** | Cancel / Go Back btn | — | Select server → Connect btn | ✗ | ✗ | ✗ | Type invalid URL |
| **Workspace** | Exit to Landing / Sign Out | ✗ | Node click in sidebar / WorkspaceSwitcher switch | Sidebar peer click → `/messages?channel=` | Sidebar nav (if exists) | Sidebar group row click | Type invalid URL |
| **Messages** | Exit to Landing / Sign Out | ✗ | Sidebar node click / back nav | — (peer-to-peer switch via list) | ✗ | ✗ | Type invalid URL |
| **Directory** | Exit to Landing / Sign Out | ✗ | Sidebar node click | "Send Message" btn → `/messages?user=` | — | ✗ | Type invalid URL |
| **Groups** | Exit to Landing / Sign Out | ✗ | "Back" btn / Leave group / Delete group | ✗ | ✗ | — (switch groups via sidebar) | Type invalid URL |
| **NotFound** | Browser back | Browser back | Browser back | Browser back | Browser back | Browser back | — |

### 1.1 Key Transitions to Test

1. **Landing → Workspace (Login)**: Enter credentials → LoadingModal → workspace loads → navigate
2. **Landing → Workspace (Join)**: ServerConnect → SecuritySettings → Join → workspace loads → navigate
3. **Landing → Workspace (Orphan Resume)**: Click orphan icon → ClaimSession → workspace loads
4. **Workspace → Landing (Soft Exit)**: Avatar → "Exit to Landing" → ExitConfirmModal → confirm → session kept
5. **Workspace → Landing (Hard Exit)**: Avatar → "Sign Out" → DisconnectLoadingModal → session destroyed
6. **Workspace → Workspace (Node Switch)**: Click different node in HierarchySidebar → URL updates `nodeId`
7. **Workspace → Workspace (Workspace Switch)**: WorkspaceSwitcher → select different workspace → full reload
8. **Workspace → Messages (Peer Click)**: Sidebar peer row → navigate to `/messages?channel=<cid>`
9. **Messages → Messages (Peer Switch)**: Click different peer in P2PPeerList → URL updates `channel`
10. **Directory → Messages**: Click "Send Message" on connected user → navigate to `/messages?user=<id>`
11. **Groups → Workspace (Leave)**: Leave group → navigate to `/workspace`
12. **Groups → Workspace (Delete)**: Delete group (owner) → navigate to `/workspace`
13. **Any protected → Landing (WS drop)**: WebSocket dies → ConnectionRetryModal → retry or return to landing

---

## 2. Feature Access Paths

Every feature accessible from EVERY entry point.

### 2.1 Settings Modal

| Access Point | Path |
|---|---|
| Landing page | Settings button (bottom) → `SettingsModal` |
| Workspace TopBar | Avatar dropdown → "Settings" → `SettingsModal` |

**Sub-paths within Settings:**
- General tab → workspace name display, notification preferences
- Connections tab → active connections, server list
- Appearance tab → theme, font size, color customization
- Privacy tab → visibility, data sharing toggles
- Permissions tab → role display, permission nodes view

### 2.2 Account Management

| Access Point | Path |
|---|---|
| Landing page | `ManageAccountsButton` → `AccountManagementDialog` |
| Workspace TopBar | `WorkspaceSwitcher` dropdown → "Manage Accounts" → `AccountManagementDialog` |

**Sub-paths within Account Management:**
- View active sessions (green border, CID displayed)
- View saved sessions (last connected timestamp)
- Switch to different account (non-current sessions)
- Delete individual saved account → `DeleteConfirmDialog`
- Clear all saved accounts → `ClearAllConfirmDialog`

### 2.3 P2P Chat

| Access Point | Path |
|---|---|
| Messages page | Select peer in `P2PPeerList` → `P2PChat` |
| Workspace page | URL: `?showP2P=true&channel=<cid>` → inline `P2PChat` |
| Sidebar peer row | Click → navigates with P2P params |
| Directory | "Send Message" on connected user → `/messages?channel=` |

**Sub-paths within P2P Chat:**
- Send text message → `P2PMessageInput`
- View message history → `P2PMessageList` → bubbles
- Chat settings → `ChatSettingsPanel` (File tab, Remote tab)
- File transfer → `FileTransferModal` / `FileDropZone`
- Live document → `LiveDocumentModal` → `CollaborativeEditor` with `CollaboratorCursor`
- Markdown editing → `MarkdownToolbar` / `EditorToolbar`

### 2.4 Peer Discovery & Connection

| Access Point | Path |
|---|---|
| Messages page | P2PPeerList → "Discover Peers" → `PeerDiscoveryModal` |
| Messages page | P2PPeerList → "Pending Requests" → `PendingRequestsModal` |
| Directory page | Click "Invite" on user → `ConnectionRequestDialog` |

### 2.5 Node Management (Create/Edit/Delete)

| Access Point | Path |
|---|---|
| Sidebar | "+" button on hierarchy → `NodeManagementModal` (create mode) |
| Sidebar | Right-click/context on node → Edit → `NodeManagementModal` (edit mode) |
| Sidebar | Right-click/context on node → Delete → confirmation → `WorkspaceService.deleteNode()` |
| Sidebar | Right-click/context on node → "Set as Default" → `WorkspaceService.updateNode()` |
| Sidebar | Right-click/context on node → "Admin Settings" → `AdminModal` |

### 2.6 File Manager

| Access Point | Path |
|---|---|
| Workspace page | URL: `?section=files` → `FileManagerContent` |
| Sidebar | `FilesSection` click → navigates with `section=files` |

**Sub-paths within File Manager:**
- Tree view → `VFSTreeView`
- Grid view → `VFSContentGrid` → `VFSGridItem`
- Path bar navigation → `VFSPathBar`
- Toolbar actions → `VFSToolbar` (upload, create folder, view toggle)
- Context menu → `VFSContextMenu` (open, rename, delete, copy, cut, paste, properties)
- File properties → `VFSPropertiesDialog`
- Rename inline → `VFSRenameInput`
- Storage usage → `VFSStorageUsage` / `FileManagerStorageBar`
- Storage limit warning → `StorageLimitModal`
- RevFS disabled warning → `RevfsDisabledModal`
- Keyboard shortcuts → `useVFSKeyboardShortcuts`
- Clipboard ops → `useVFSClipboard`
- Selection → `useVFSSelection`

### 2.7 Workspace Switching

| Access Point | Path |
|---|---|
| TopBar | `WorkspaceSwitcher` dropdown → select different workspace |
| TopBar | `WorkspaceSwitcher` dropdown → "Add Workspace" → ServerConnect → SecuritySettings → Join |
| TopBar | `WorkspaceSwitcher` dropdown → "Add Account" to existing workspace → ServerConnect flow |

### 2.8 Group Chat

| Access Point | Path |
|---|---|
| Sidebar | `GroupConversationRow` click → `/groups/:groupId` |
| Create group | Sidebar "+" or create button → `CreateGroupDialog` → select members → create |

---

## 3. State-Based Flow Matrix

### 3.1 Authentication State Transitions

```
UNAUTHENTICATED ──Login──→ LOADING ──Success──→ AUTHENTICATED ──Exit──→ UNAUTHENTICATED
                  ──Join───→ LOADING ──Success──→ AUTHENTICATED ──SignOut→ UNAUTHENTICATED
                                      ──Failure──→ ERROR ──Retry/Cancel──→ UNAUTHENTICATED
```

### 3.2 Session Lifecycle

```
NO_SESSION ──Connect──→ ACTIVE ──TabClose──→ ORPHANED ──ClaimSession──→ ACTIVE
                                             ──Timeout──→ EXPIRED
            ACTIVE ──Disconnect──→ DESTROYED (removed from storage)
            ACTIVE ──ExitToLanding──→ ORPHANED (session kept, tab navigates away)
```

### 3.3 P2P Connection Lifecycle

```
UNKNOWN ──PeerRegister──→ REGISTERING ──Success──→ REGISTERED
                                       ──Failure──→ UNKNOWN
REGISTERED ──PeerConnect──→ CONNECTING ──Success──→ CONNECTED ──canMessageUser()=true
                                        ──Failure──→ REGISTERED
CONNECTED ──PeerDisconnect──→ REGISTERED
```

### 3.4 Workspace Data Loading

```
PAGE_LOAD ──WorkspaceLoader guard──→ LOADING_WORKSPACE
  ──loadWorkspace()──→ LOADING_NODES
  ──listNodes()──→ LOADING_MEMBERS
  ──listMembers()──→ READY (render children)
  ──AnyFailure──→ WorkspaceNotInitializedModal / Error state
```

---

## 4. Edge-Case Scenarios to Test

### 4.1 Navigation Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| N1 | Direct URL to `/workspace` without login | `WorkspaceLoader` blocks, redirects or shows error |
| N2 | Direct URL to `/messages` without login | Same as N1 |
| N3 | Direct URL to `/groups/invalid-id` | "Group not found" toast → redirect to `/workspace` |
| N4 | Browser back from `/workspace` to `/` | Should show Landing, session remains active |
| N5 | Browser forward after Sign Out | Should NOT re-enter workspace (session destroyed) |
| N6 | Refresh on `/workspace?nodeId=<id>` | Should reload workspace and select correct node |
| N7 | Refresh on `/messages?channel=<cid>` | Should reload and select correct peer conversation |
| N8 | Navigate from node A to node B while P2P chat overlay is open | P2P params (`showP2P`, `channel`, `p2pUser`) must be cleared |
| N9 | Switch workspace while on `/messages` | Should navigate to new workspace's `/workspace` |
| N10 | Switch workspace while admin modal is open | Modal should close, new workspace loads |

### 4.2 Authentication Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| A1 | Login with wrong credentials | `ConnectFailure` → error toast, stay on Landing |
| A2 | Join with duplicate username | `RegisterFailure` → error toast |
| A3 | Login while session already active for same user | `LoginConflictModal` appears |
| A4 | Multiple tabs, sign out from one | Other tabs should detect session loss |
| A5 | Login → close tab → reopen app | Orphan session detected → OrphanSessionsNavbar |
| A6 | Attempt to switch account while offline | Should show error, not corrupt state |

### 4.3 Messaging Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| M1 | Send message to offline peer | Message queued or error shown |
| M2 | Receive message while on different page | Notification appears via `NotificationCenter` |
| M3 | Send file to peer with no P2P connection | "Connection Required" toast |
| M4 | Open live document simultaneously from two users | `CollaborativeEditor` syncs via Yjs |
| M5 | Switch peer conversation mid-typing | Input should clear, typing indicator should stop |
| M6 | Send message in group after being kicked | Should fail gracefully |

### 4.4 Workspace Management Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| W1 | Delete currently-viewed node | Navigate away, toast success |
| W2 | Create node when empty hierarchy (first node) | Empty state CTA should work, node appears |
| W3 | Edit node name while another user is viewing it | Update should propagate |
| W4 | Set default node, then delete it | Next default should be assigned or handled |
| W5 | Open admin modal on node without admin role | Should be blocked/hidden |
| W6 | Workspace init on first login | `WorkspaceInitializationModal` appears |

### 4.5 File Manager Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| F1 | Upload file exceeding storage limit | `StorageLimitModal` appears |
| F2 | RevFS not enabled for workspace | `RevfsDisabledModal` appears |
| F3 | Rename file to existing name | Error handling |
| F4 | Cut file, navigate away, come back, paste | Clipboard state preserved or cleared |
| F5 | Delete folder with contents | Confirmation with count of affected items |
| F6 | Keyboard shortcut (Ctrl+C/V/X) conflicts with browser | `useVFSKeyboardShortcuts` must handle correctly |

### 4.6 Multi-Tab / Multi-Session Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| T1 | Leader tab closes, follower promotes | `BroadcastChannel` leader election, WS transfers |
| T2 | Two tabs, different users, send P2P between them | Messages route through leader tab's WebSocket |
| T3 | Switch accounts in `AccountManagementDialog` | Tab context updates, workspace reloads |
| T4 | One tab switches workspace, other tab stays | Independent workspace contexts |

### 4.7 Connection Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| C1 | WebSocket drops during message send | `ConnectionRetryModal` appears, retry option |
| C2 | Server restarts while user is connected | Reconnection attempt → retry modal |
| C3 | WASM client not initialized | Graceful error, no crash |
| C4 | Timeout during login (>60s) | `LoadingModal` shows cancel/timeout state |

---

## 5. Complete Feature × Page Availability Matrix

| Feature | Landing | Connect | Workspace | Messages | Directory | Groups |
|---|---|---|---|---|---|---|
| Login flow | ✅ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Join flow | ✅ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Orphan session bar | ✅ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Account management | ✅ | ✗ | ✅ (via switcher) | ✅ | ✅ | ✗ |
| Settings modal | ✅ | ✗ | ✅ | ✅ | ✅ | ✗ |
| Sidebar (hierarchy) | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| Sidebar (members) | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| Sidebar (files) | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| Sidebar (admin) | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| TopBar | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| WorkspaceSwitcher | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| Notification center | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| User dropdown | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| MDX editor | ✗ | ✗ | ✅ | ✗ | ✗ | ✗ |
| P2P chat | ✗ | ✗ | ✅ (inline) | ✅ (dedicated) | ✗ | ✗ |
| File manager | ✗ | ✗ | ✅ | ✗ | ✗ | ✗ |
| Peer discovery | ✗ | ✗ | ✗ | ✅ | ✗ | ✗ |
| Connection requests | ✗ | ✗ | ✗ | ✗ | ✅ | ✗ |
| User search | ✗ | ✗ | ✗ | ✗ | ✅ | ✗ |
| Group settings | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ |
| Group role mgmt | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ |
| Node management | ✗ | ✗ | ✅ | ✗ | ✗ | ✗ |
| Permission manager | ✗ | ✗ | ✅ | ✗ | ✗ | ✗ |
| Tree graph editor | ✗ | ✗ | ✅ | ✗ | ✗ | ✗ |
| File transfer | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |
| Live documents | ✗ | ✗ | ✅ | ✅ | ✗ | ✗ |

> **Note**: `UserDirectory` and `GroupChatPage` do NOT use `AppLayout` — they lack the sidebar and TopBar. This is a potential UX inconsistency to evaluate.
