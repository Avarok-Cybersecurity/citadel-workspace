# Citadel Workspaces — Complete Codemap

> **Source of truth** — derived exclusively from reading every route, page, component, hook, context, service, and type file in `citadel-workspaces/src/`.

---

## 1. Route Map

| Route | Component | Guard | Purpose |
|---|---|---|---|
| `/` | `Landing` | None | Entry point — login, join, orphan session bar, settings, account management |
| `/connect` | `Connect` | None | Reconnect to a previously-saved server |
| `/workspace` | `Office` → `WorkspaceView` or `FileManagerContent` | `WorkspaceLoader` | Main workspace: node content (MDX), inline P2P chat, or file manager |
| `/messages` | `Messages` | `WorkspaceLoader` | Dedicated P2P messaging page (peer list + chat) |
| `/directory` | `UserDirectory` | `WorkspaceLoader` | Member discovery, search, connection requests |
| `/groups/:groupId` | `GroupChatPage` | `WorkspaceLoader` | Group chat with settings, roles, member management |
| `*` | `NotFound` | None | 404 catch-all |

---

## 2. Pages — Detailed Feature Inventory

### 2.1 Landing (`/`)

| Feature | Component(s) | Notes |
|---|---|---|
| Login flow | `Login` overlay | Username, password, server address → `ConnectSuccess` → navigate to `/workspace` |
| Join (register) flow | `ServerConnect` → `SecuritySettings` → `Join` overlays | 3-step wizard: server → security params → credentials |
| Orphan session bar | `OrphanSessionsNavbar` | Detects active backend sessions, shows icons to re-enter |
| Login conflict modal | `LoginConflictModal` | Warns if session already exists for username |
| Account management | `ManageAccountsButton` → `AccountManagementDialog` | View active/saved sessions, switch, delete, clear all |
| Settings (global) | `SettingsModal` (5 tabs: General, Connections, Appearance, Privacy, Permissions) | Accessible from Landing |

### 2.2 Connect (`/connect`)

| Feature | Component(s) | Notes |
|---|---|---|
| Server list | Inline list | Lists previously-saved servers from `listKnownServers()` |
| Select & connect | `handleConnect()` | Selects server → navigates to `/workspace` |
| Go back | Button | Returns to `/` |

### 2.3 Workspace / Office (`/workspace`)

**URL params**: `?nodeId=<id>&section=<files|…>&showP2P=true&channel=<cid>&p2pUser=<name>`

| Feature | Component(s) | Notes |
|---|---|---|
| Sidebar — Hierarchy tree | `HierarchySidebar` → `TreeNodesSection` → `TreeNodeItem` | Schema-driven Office/Room tree with expand/collapse |
| Sidebar — Members | `MembersSection` → `MemberListItems` + `MembersSectionModals` | List workspace members, invite, view roles |
| Sidebar — Files | `FilesSection` → `FilePreviewDialog` | Quick file access from sidebar |
| Sidebar — Admin | `AdminSettingsSection` | Admin-only section |
| Top bar | `TopBar` | Workspace switcher, notifications, user avatar dropdown |
| Workspace switcher | `WorkspaceSwitcher` → `WorkspaceSwitcherDropdown` | Switch between workspaces, add workspace, add account to workspace, manage accounts |
| Notification center | `NotificationCenter` → `NotificationItem` | In-app notifications |
| User dropdown | Avatar → Profile, Settings, Exit to Landing, Sign Out | 4 actions from dropdown |
| Node content (MDX) | `BaseOffice` → `OfficeLayout` + `MDXEditor` + `MDXToolbar` + `TemplateSelector` + `MediaUploader` | Rich MDX content editing per node |
| Inline P2P chat | `P2PChat` (via `WorkspaceView` when `showP2P=true`) | P2P chat overlay within workspace |
| File manager | `FileManagerContent` (when `section=files`) | Full VFS: tree view, grid view, toolbar, context menu, path bar, storage bar, properties dialog, rename, clipboard (copy/cut/paste), keyboard shortcuts |
| Node management | `NodeManagementModal` | Create/edit nodes (offices/rooms) |
| Admin modal | `AdminModal` → `GeneralTab`, `MembersTab`, `ChatSettingsTab` | Per-node admin settings |
| Tree graph editor | `TreeGraphEditor` → `TreeGraphNode` + `TreeGraphContextMenu` | Visual node graph editing |
| P2P peer discovery | `PeerDiscoveryModal`, `PendingRequestsModal` | Discover and connect with peers |
| Exit confirm | `ExitConfirmModal` | Confirms exit to landing (soft exit) |
| Disconnect modal | `DisconnectLoadingModal` | Sign-out progress (disconnecting → cleaning → ready) |
| Profile modal | `ProfileModal` | View/edit profile |
| Settings modal | `SettingsModal` | Same 5-tab settings |
| Connection retry | `ConnectionRetryModal` | WebSocket reconnection UI |
| Workspace init | `WorkspaceInitializationModal` | First-time workspace setup |
| Workspace not init | `WorkspaceNotInitializedModal` | Prompt when workspace doesn't exist |
| Connection preferences | `PreferencesDialog` | Connection preferences |
| Permission manager | `PermissionManagerModal` → `PermissionManager` | Role-based permission editing |
| Member management | `MemberManagementModal` | Add/remove members |
| Room content | `Room` → `RoomContentView` | Room-specific content display |

### 2.4 Messages (`/messages`)

**URL params**: `?channel=<peerCid>`

| Feature | Component(s) | Notes |
|---|---|---|
| Peer list | `P2PPeerList` → `PeerListItem`, `ConversationPeerItem` | Lists registered peers with online status |
| P2P chat | `P2PChat` → `P2PChatHeader` + `P2PMessageList` + `P2PMessageInput` | Full messaging: text, typing indicators, message bubbles |
| Chat settings | `ChatSettingsPanel` → File tab, Remote tab | Per-conversation settings |
| File transfer | `FileTransferModal`, `FileDropZone` | Send/receive files via drag-drop or picker |
| Live document | `LiveDocumentModal` → `LiveDocumentView` → `CollaborativeEditor` + `CollaboratorCursor` | Real-time collaborative document editing |
| Chat tab bar | `ChatTabBar` + `TypeSelectorBar` | Switch between chat views |
| Markdown toolbar | `MarkdownToolbar` + `EditorToolbar` | Rich text formatting in messages |

### 2.5 User Directory (`/directory`)

| Feature | Component(s) | Notes |
|---|---|---|
| User search | `UserSearch` | Search by name/email |
| Member list | `MemberListItem` list | All/Online filter tabs |
| User profile card | `UserProfileCard` | Selected user details panel |
| Send message | Navigate to `/messages?user=<id>` | Requires active P2P connection |
| Connection request | `ConnectionRequestDialog` | Send P2P registration request |

### 2.6 Group Chat (`/groups/:groupId`)

| Feature | Component(s) | Notes |
|---|---|---|
| Group chat view | `GroupChatView` → `GroupMessageItem` + `GroupMessageFooter` | Real-time group messaging |
| Group header | `GroupChatHeader` | Group name, member count, settings button |
| Group settings | `GroupSettingsPanel` → `GroupMemberManagement` + `GroupRoleManagement` + `GroupRoleEditor` | Full group admin panel |
| Create group | `CreateGroupDialog` → `CreateGroupMembersTable` | Select members, set name |
| Role management | `GroupRoleEditor` + `GroupRoleHelpers` | Create/edit custom roles |
| Member management | `GroupMemberManagement` + `GroupMemberManagementHelpers` | Kick, change role |
| Delete group | `GroupDeleteConfirmDialog` | Owner-only destructive action |
| Retryable send | `RetryableMessageSender` | Auto-retry failed messages |
| Typing indicator | `TypingIndicator` | Shows who is typing |
| Back to workspace | Arrow button | Navigate to `/workspace` |

---

## 3. Global Features (Available Across Protected Routes)

| Feature | Access Point | Components |
|---|---|---|
| Sidebar toggle | Hamburger menu (mobile) | `AppLayout` + `useSidebar()` |
| Workspace switching | TopBar → `WorkspaceSwitcher` dropdown | `WorkspaceSwitcherDropdown` → can add workspace (Server→Security→Join flow) |
| Notifications | TopBar → bell icon | `NotificationCenter` |
| Profile | TopBar → avatar → "Profile" | `ProfileModal` |
| Settings | TopBar → avatar → "Settings" | `SettingsModal` (General, Connections, Appearance, Privacy, Permissions) |
| Exit to Landing | TopBar → avatar → "Exit to Landing" | `ExitConfirmModal` → soft exit (session kept) |
| Sign Out | TopBar → avatar → "Sign Out" | `DisconnectLoadingModal` → hard exit (session destroyed) |
| Leader indicator | TopBar | `LeaderIndicator` — shows if this tab is the WebSocket leader |
| Connection retry | Automatic on WS drop | `ConnectionRetryModal` |
| Orphan session recovery | Automatic detection | `useOrphanSessions` hook |
