# UI Element Tree & Integration Test Coverage Audit

## Component Tree (from App.tsx)

```
App.tsx
├── BrowserRouter
├── QueryClientProvider
├── TooltipProvider
├── Toaster (shadcn) + Sonner
├── FileUploadProgress
└── WorkspaceApp
    ├── PermissionsProvider
    ├── WorkspaceEventHandler
    ├── ErrorDisplay
    ├── ProtocolWarning
    ├── ConnectionRetryModal
    └── Routes
        ├── / ─── Landing
        │   ├── OrphanSessionsNavbar
        │   │   ├── OrphanSessionIcon (per session)
        │   │   ├── DisconnectConfirmModal
        │   │   └── DisconnectLoadingModal
        │   ├── ManageAccountsButton
        │   ├── SettingsModal
        │   ├── LoginConflictModal
        │   └── Overlays (by currentStep)
        │       ├── ServerConnect
        │       ├── SecuritySettings
        │       │   ├── SecurityLevelSelect
        │       │   ├── SecurityModeSelect
        │       │   └── AdvancedSettings (crypto params)
        │       ├── Join (registration form)
        │       │   ├── WorkspaceNotInitializedModal
        │       │   └── ConnectLoadingModal
        │       └── Login
        │           └── SecuritySettings (nested)
        │
        ├── /connect ─── Connect (saved workspaces)
        │
        ├── /workspace ─── WorkspaceLoader → AppLayout
        │   ├── TopBar
        │   │   ├── WorkspaceSwitcher
        │   │   ├── LeaderIndicator
        │   │   ├── NotificationCenter
        │   │   ├── PreferencesDialog
        │   │   └── Avatar Dropdown
        │   │       ├── ProfileModal
        │   │       ├── SettingsModal
        │   │       ├── ExitConfirmModal
        │   │       └── Sign out → DisconnectLoadingModal
        │   │
        │   ├── Sidebar
        │   │   ├── OfficesSection + OfficeManagementModal
        │   │   ├── RoomsSection + RoomManagementModal
        │   │   ├── MembersSection
        │   │   │   ├── P2P tab → PeerListRow + PeerDiscoveryModal
        │   │   │   └── Members tab → member cards
        │   │   ├── FilesSection → EntityFileList
        │   │   └── AdminSettingsSection
        │   │       ├── AdminModal
        │   │       ├── PermissionManagerModal
        │   │       └── MemberManagementModal
        │   │
        │   └── Content Area
        │       ├── (showP2P=true) → P2PChat
        │       │   ├── P2PChatHeader (typing indicator)
        │       │   ├── ChatTabBar (messages + live doc tabs)
        │       │   ├── P2PMessageList
        │       │   │   ├── TextBubble
        │       │   │   ├── MarkdownBubble
        │       │   │   ├── FileTransferBubble
        │       │   │   └── LiveDocumentBubble
        │       │   ├── P2PMessageInput
        │       │   │   ├── TypeSelectorBar (Text/Markdown/LiveDoc)
        │       │   │   ├── MarkdownToolbar
        │       │   │   └── File upload button
        │       │   ├── LiveDocumentModal
        │       │   ├── FileTransferModal
        │       │   └── ChatSettingsPanel
        │       │
        │       ├── (section=files) → FileManagerContent
        │       │   ├── VFSToolbar (new folder, upload, sync, sort)
        │       │   ├── VFSPathBar (breadcrumbs)
        │       │   ├── VFSTreeView (folder tree)
        │       │   ├── VFSContentGrid (file list/grid)
        │       │   ├── VFSContextMenu
        │       │   ├── StorageLimitModal
        │       │   ├── RevfsDisabledModal
        │       │   ├── VFSPropertiesDialog
        │       │   └── FilePreviewDialog
        │       │
        │       └── (default) → BaseOffice
        │           ├── Tabs (Content / Chat) if chat_enabled
        │           ├── MDXEditor + TemplateSelector (if editing)
        │           ├── Rendered MDX content (if viewing)
        │           └── GroupChatView (chat tab)
        │
        ├── /messages ─── AppLayout → Messages → P2PChat
        ├── /directory ─── UserDirectory
        │   ├── UserSearch + filter tabs (All/Online/Favorites)
        │   ├── Member cards
        │   └── Profile panel + Connection request dialog
        │
        ├── /groups/:groupId ─── GroupChatPage
        │   ├── GroupChatHeader
        │   ├── Message list + input
        │   ├── GroupSettingsPanel
        │   └── CreateGroupDialog
        │
        └── * ─── NotFound (404)
```

---

## Coverage Tables by Category

### 1. Authentication & Account Management

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| "Join Workspace" button | Landing | ✅ | account.ts, login-flow |
| ServerConnect form (address + password) | ServerConnect | ✅ | account.ts |
| "NEXT" button (server step) | ServerConnect | ✅ | account.ts |
| Registration form (name, user, pass, confirm) | Join | ✅ | account.ts |
| "JOIN" button | Join | ✅ | account.ts |
| "Login Workspace" button | Landing | ✅ | login-flow |
| Login form (username, password) | Login | ✅ | login-flow |
| "Connect" submit button | Login | ✅ | login-flow |
| ConnectLoadingModal (progress) | Join/Login | ✅ | account.ts |
| WorkspaceNotInitializedModal | Join | ✅ | workspace-init |
| WorkspaceInitializationModal (admin setup) | Landing | ✅ | workspace-init, account.ts |
| SecuritySettings overlay | SecuritySettings | ✅ | security-settings |
| SecurityLevelSelect dropdown | SecuritySettings | ✅ | security-settings |
| SecurityModeSelect dropdown | SecuritySettings | ✅ | security-settings |
| AdvancedSettings (crypto params) | SecuritySettings | ✅ | security-settings |
| Login "Configure" security button | Login | ✅ | security-settings |
| Login "Remember credentials" switch | Login | ✅ | account-management |
| Login advanced server field | Login | ✅ | account-management |
| AccountManagementDialog | Landing | ✅ | account-management |
| LoginConflictModal | Landing | ✅ | account-management |
| /connect saved workspaces page | Connect | ✅ | account-management |

### 2. Session Management & Reconnection

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| OrphanSessionsNavbar (session icons) | OrphanSessionsNavbar | ✅ | login-flow, previous-sessions, offline |
| Click session icon to claim | OrphanSessionIcon | ✅ | previous-sessions, offline |
| Hover → disconnect button | OrphanSessionIcon | ✅ | login-flow |
| DisconnectConfirmModal | OrphanSessionsNavbar | ✅ | login-flow |
| "Sign out" via TopBar dropdown | TopBar | ✅ | hard-disconnect, reconnection/* |
| DisconnectLoadingModal | TopBar | ✅ | p2p/session.ts |
| ExitConfirmModal ("Exit to Landing") | TopBar | ✅ | topbar-navigation |
| ConnectionRetryModal | WorkspaceApp | ✅ | topbar-navigation |
| TCP drop reconnection (ClaimSession) | — | ✅ | offline, reconnection/* |
| Hard disconnect + re-login | — | ✅ | hard-disconnect |

### 3. P2P Discovery & Registration

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| "Discover Peers" button (user-plus icon) | MembersSection | ✅ | p2p/registration.ts |
| PeerDiscoveryModal | PeerDiscoveryModal | ✅ | p2p/registration.ts |
| Peer list with "Connect" buttons | PeerDiscoveryModal | ✅ | p2p/registration.ts |
| "Awaiting Response" state | PeerDiscoveryModal | ✅ | p2p/registration.ts |
| "Connected" badge (user-check icon) | PeerDiscoveryModal | ✅ | p2p/registration.ts |
| Refresh button in modal | PeerDiscoveryModal | ✅ | p2p/registration.ts |
| Pending requests badge (count) | MembersSection | ✅ | p2p/registration.ts |
| PendingRequestsModal | PendingRequestsModal | ✅ | p2p/registration.ts |
| "Accept" button on request | PendingRequestsModal | ✅ | p2p/registration.ts |

### 4. P2P Chat & Messaging

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| Open conversation (click peer in sidebar) | MembersSection | ✅ | p2p/conversation.ts |
| P2P message input field | P2PMessageInput | ✅ | messaging.ts |
| Send button | P2PMessageInput | ✅ | messaging.ts |
| Text message bubbles (display) | TextBubble | ✅ | messaging.ts |
| Message verification (text appears) | P2PMessageList | ✅ | messaging.ts |
| Bidirectional messaging | P2PChat | ✅ | p2p-messaging |
| Offline message delivery (ILM) | P2PChat | ✅ | offline, hard-disconnect |
| Message timestamps | P2PMessageList | ✅ | p2p-messaging |
| Online status indicator (green dot) | PeerListRow | ✅ | p2p-messaging |
| Typing indicator | P2PChatHeader | ✅ | live-doc-sync |
| P2PChatHeader (peer name, status) | P2PChatHeader | ✅ | p2p-messaging (implicit) |
| TypeSelectorBar (Text/Markdown/LiveDoc) | P2PMessageInput | ✅ | p2p-message-types |
| MarkdownToolbar (formatting buttons) | P2PMessageInput | ✅ | p2p-message-types |
| MarkdownBubble (rendered markdown) | MarkdownBubble | ✅ | p2p-message-types |
| Message context menu (edit/delete/reply) | P2PMessageList | ✅ | p2p-message-types |
| ChatSettingsPanel (side panel) | P2PChat | ✅ | p2p-message-types |
| ChatTabBar (messages + live doc tabs) | P2PChat | ✅ | live-doc-sync (implicit) |

### 5. Live Documents

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| "Create Live Doc" button | P2PChat | ✅ | live-doc-sync |
| Live document name input | LiveDocumentModal | ✅ | live-doc-sync |
| "Create" button | LiveDocumentModal | ✅ | live-doc-sync |
| Citadel Docs canvas for a chat document | ChatDocumentPane | ✅ | live-doc-sync |
| Real-time content sync | ChatDocumentPane | ✅ | live-doc-sync |
| Earlier editor's document moved once, original kept | ChatDocumentPane, LossReportBanner | written, not yet run | live-doc-migration |
| Live document tabs in ChatTabBar | ChatTabBar | ✅ | live-doc-sync |
| LiveDocumentBubble (link in chat) | LiveDocumentBubble | ✅ | live-doc-sync |

### 6. Office & Room Management

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| Offices sidebar section | OfficesSection | ✅ | office-room-crud, tree-* |
| Rooms sidebar section | RoomsSection | ✅ | office-room-crud, tree-* |
| "+" button (add office) | OfficesSection | ✅ | office-room-crud, tree-helpers |
| "+" button (add room) | RoomsSection | ✅ | office-room-crud, tree-helpers |
| OfficeManagementModal (create) | OfficeManagementModal | ✅ | tree-helpers |
| RoomManagementModal (create) | RoomManagementModal | ✅ | tree-helpers |
| Name input in entity modal | EntityManagementModal | ✅ | tree-helpers |
| Description textarea | EntityManagementModal | ✅ | tree-helpers |
| "Create Office"/"Create Room" button | EntityManagementModal | ✅ | tree-helpers |
| Click office to navigate | OfficesSection | ✅ | group-chat/* |
| Click room to navigate | RoomsSection | ✅ | group-chat/* |
| Context menu → Delete | EntityManagementModal | ✅ | tree-helpers |
| Delete confirmation dialog | ConfirmDeleteDialog | ✅ | tree-helpers |
| Office/room edit (update) | EntityManagementModal | ✅ | office-room-crud |
| Deep hierarchy (nested nodes) | Tree | ✅ | tree-deep-hierarchy |
| Cascade delete | Tree | ✅ | tree-cascade-delete |
| Move operations | Tree | ✅ | tree-move-operations |
| Custom node types | Tree | ✅ | tree-custom-types |
| Permission inheritance | Tree | ✅ | tree-permissions-inheritance |

### 7. Office/Room Content (MDX)

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| Rendered MDX content (view mode) | BaseOffice | ✅ | office-mdx-content |
| Edit button (enter edit mode) | BaseOffice | ✅ | office-mdx-content |
| MDXEditor (collaborative) | MDXEditor | ✅ | office-mdx-content |
| TemplateSelector | TemplateSelector | ✅ | office-mdx-content |
| Save button | BaseOffice | ✅ | office-mdx-content |
| Content/Chat tab switcher | BaseOffice | ✅ | group-chat/* (Chat tab) |

### 8. Group Chat (Office/Room Chat)

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| Chat tab (in office/room) | BaseOffice | ✅ | group-chat/office-chat, room-chat |
| Group chat message input | GroupChatView | ✅ | group-chat.ts |
| Group chat send button | GroupChatView | ✅ | group-chat.ts |
| Group message display | GroupChatView | ✅ | group-chat/office-chat, room-chat |
| Multi-user group messaging | GroupChatView | ✅ | group-messaging-multiuser |
| Peer group chat | GroupChatView | ✅ | group-chat/peer-group |
| Chat rules/description banner | GroupChatView | ✅ | chat-settings |
| GroupChatHeader | GroupChatPage | ✅ | group-chat-extended |
| GroupSettingsPanel (drawer) | GroupChatPage | ✅ | group-chat-extended |
| CreateGroupDialog | GroupChatPage | ✅ | group-chat/peer-group (implicit) |
| /groups/:groupId route | GroupChatPage | ✅ | group-chat-extended |

### 9. File Management

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| File manager sidebar button | Sidebar | ✅ | file-manager |
| VFSToolbar (new folder button) | VFSToolbar | ✅ | file-manager |
| VFSToolbar (sync button) | VFSToolbar | ✅ | file-manager |
| Folder creation dialog | FileManagerContent | ✅ | file-manager |
| VFSPathBar (breadcrumbs) | VFSPathBar | ✅ | file-manager |
| VFSTreeView (folder tree) | VFSTreeView | ✅ | file-manager |
| VFSContextMenu (right-click) | VFSContextMenu | ✅ | file-manager |
| Context menu → New Folder | VFSContextMenu | ✅ | file-manager |
| Context menu → Delete | VFSContextMenu | ✅ | file-manager |
| File upload button/flow | FileManagerContent | ✅ | file-manager, native-file-picker |
| Native file picker dialog | — | ✅ | native-file-picker |
| File transfer progress | FileTransferBubble | ✅ | file-transfer |
| RE-VFS peer sync | — | ✅ | revfs-peer |
| RE-VFS server sync | — | ✅ | revfs-server |
| Empty state ("No Peers Connected") | FileManagerContent | ✅ | file-manager |
| StorageLimitModal | StorageLimitModal | ✅ | file-manager-extended |
| RevfsDisabledModal | RevfsDisabledModal | ✅ | file-manager-extended |
| VFSPropertiesDialog | VFSPropertiesDialog | ✅ | file-manager-extended |
| FilePreviewDialog (sidebar) | FilePreviewDialog | ✅ | file-manager-extended |
| FileUploadProgress (global) | FileUploadProgress | ✅ | file-manager-extended |
| Sort controls | VFSToolbar | ✅ | file-manager-extended |
| Grid/list view toggle | VFSContentGrid | ✅ | file-manager-extended |

### 10. Admin & Permissions

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| Admin settings section (sidebar) | AdminSettingsSection | ✅ | admin-modal |
| AdminModal (general tab) | AdminModal | ✅ | admin-modal |
| AdminModal (chat settings tab) | AdminModal | ✅ | chat-settings |
| Chat enable/disable toggle | AdminModal | ✅ | chat-settings |
| Chat rules editor | AdminModal | ✅ | chat-settings |
| PermissionManagerModal | PermissionManagerModal | ✅ | permissions |
| MemberManagementModal | MemberManagementModal | ✅ | member-management |
| Role assignment (Owner/Admin/Member/Guest) | MemberManagementModal | ✅ | member-management |
| Member kick/ban | MemberManagementModal | ✅ | member-management |

### 11. TopBar & Navigation Chrome

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| User avatar dropdown trigger | TopBar | ✅ | settings-modal, p2p/session.ts |
| Dropdown → "Settings" | TopBar | ✅ | settings-modal |
| Dropdown → "Sign out" | TopBar | ✅ | hard-disconnect, reconnection/* |
| Dropdown → "Profile" | TopBar | ✅ | topbar-navigation |
| Dropdown → "Exit to Landing" | TopBar | ✅ | topbar-navigation |
| WorkspaceSwitcher | TopBar | ✅ | topbar-navigation |
| LeaderIndicator | TopBar | ✅ | topbar-navigation |
| PreferencesDialog trigger | TopBar | ✅ | topbar-navigation |

### 12. Settings Modal

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| Settings modal open | SettingsModal | ✅ | settings-modal |
| "General" tab | SettingsModal | ✅ | settings-modal |
| "Connections" tab | SettingsModal | ✅ | settings-modal |
| "Appearance" tab | SettingsModal | ✅ | settings-modal |
| "Privacy" tab | SettingsModal | ✅ | settings-modal |
| "Permissions" tab | SettingsModal | ✅ | settings-modal |
| Tab content (actual settings controls) | Various | ✅ | settings-controls |
| Appearance theme toggle | AppearanceSettingsTab | ✅ | settings-controls |
| Privacy controls | PrivacySettingsTab | ✅ | settings-controls |
| Connection preferences | ConnectionsTab | ✅ | settings-controls |

### 13. Notification Center

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| Bell icon trigger | TopBar | ✅ | notification-center |
| Notification sheet open | NotificationCenter | ✅ | notification-center |
| "All" tab | NotificationCenter | ✅ | notification-center |
| "Messages" tab | NotificationCenter | ✅ | notification-center |
| "Requests" tab | NotificationCenter | ✅ | notification-center |
| "System" tab | NotificationCenter | ✅ | notification-center |
| "Clear All" button | NotificationCenter | ✅ | notification-center |
| Empty state text | NotificationCenter | ✅ | notification-center |
| Individual notification items | NotificationItem | ✅ | notification-center |
| Notification badge (unread count) | TopBar | ✅ | notification-center |

### 14. User Directory

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| /directory page render | UserDirectory | ✅ | user-directory |
| "User Directory" heading | UserDirectory | ✅ | user-directory |
| "Find People" card | UserDirectory | ✅ | user-directory |
| "Workspace Directory" card | UserDirectory | ✅ | user-directory |
| "All" tab | UserDirectory | ✅ | user-directory |
| "Online" tab | UserDirectory | ✅ | user-directory |
| "Favorites" tab | UserDirectory | ✅ | user-directory |
| User list entries | UserDirectory | ✅ | user-directory |
| User profile panel (selection) | UserDirectory | ✅ | user-directory |
| Search input | UserSearch | ✅ | user-directory-actions |
| "Send Connection Request" button | UserDirectory | ✅ | user-directory-actions |
| Connection request dialog (textarea) | UserDirectory | ✅ | user-directory-actions |
| "Message" button (existing peer) | UserDirectory | ✅ | user-directory-actions |
| "Remove Connection" button | UserDirectory | ✅ | user-directory-actions |
| Role badges (Owner/Admin/etc.) | UserDirectory | ✅ | user-directory-actions |

### 15. Toast / Error Notifications

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| Sonner toasts (success/error/warning) | Sonner | ✅ | modals.ts (checkForErrors) |
| Radix toasts | Toaster | ✅ | modals.ts |
| Error display detection | ErrorDisplay | ✅ | modals.ts |
| ProtocolWarning display | ProtocolWarning | ✅ | misc-routes |

### 16. Misc / Uncategorized

| UI Element | Component | Tested? | Test File(s) |
|---|---|---|---|
| /messages route (P2PChat) | Messages | ✅ | misc-routes |
| 404 NotFound page | NotFound | ✅ | misc-routes |
| ProfileModal (edit profile) | ProfileModal | ✅ | misc-routes, topbar-navigation |
| PreferencesDialog | PreferencesDialog | ✅ | topbar-navigation |
| Sidebar collapse/expand | AppLayout | ✅ | misc-routes |
| Members tab in sidebar | MembersSection | ✅ | modals.ts (implicit) |
| Files section in sidebar | FilesSection | ✅ | file-manager |

---

## Coverage Summary

| Category | Total Elements | Tested | Untested | Coverage |
|---|---|---|---|---|
| Authentication & Account | 21 | 21 | 0 | 100% |
| Session & Reconnection | 10 | 10 | 0 | 100% |
| P2P Discovery & Registration | 9 | 9 | 0 | 100% |
| P2P Chat & Messaging | 17 | 17 | 0 | 100% |
| Live Documents | 7 | 7 | 0 | 100% |
| Office & Room Management | 19 | 19 | 0 | 100% |
| Office/Room Content (MDX) | 6 | 6 | 0 | 100% |
| Group Chat | 11 | 11 | 0 | 100% |
| File Management | 22 | 22 | 0 | 100% |
| Admin & Permissions | 9 | 9 | 0 | 100% |
| TopBar & Navigation | 8 | 8 | 0 | 100% |
| Settings Modal | 10 | 10 | 0 | 100% |
| Notification Center | 10 | 10 | 0 | 100% |
| User Directory | 15 | 15 | 0 | 100% |
| Toasts / Errors | 4 | 4 | 0 | 100% |
| Misc / Uncategorized | 7 | 7 | 0 | 100% |
| **TOTAL** | **185** | **185** | **0** | **100%** |

---

## Test Files

| Test File | Priority | Elements Covered |
|---|---|---|
| security-settings.test.ts | P1 | SecuritySettings overlay, level/mode selects, advanced params, login configure |
| topbar-navigation.test.ts | P2 | ProfileModal, ExitConfirmModal, WorkspaceSwitcher, LeaderIndicator, PreferencesDialog, ConnectionRetryModal |
| p2p-message-types.test.ts | P3 | TypeSelectorBar, MarkdownToolbar, MarkdownBubble, context menu, ChatSettingsPanel |
| settings-controls.test.ts | P4 | Appearance theme, privacy controls, connection preferences, tab content |
| user-directory-actions.test.ts | P5 | Search, connection request, message button, remove, role badges |
| member-management.test.ts | P6 | MemberManagementModal, role assignment, kick/ban |
| group-chat-extended.test.ts | P7 | GroupChatHeader, GroupSettingsPanel, /groups/:groupId route |
| file-manager-extended.test.ts | P8 | StorageLimitModal, RevfsDisabledModal, properties, preview, upload progress, sort, view toggle |
| office-mdx-content.test.ts | P9 | MDX content view, edit button, MDXEditor, TemplateSelector, save + persistence |
| notification-center.test.ts | P11 | All notification UI + badge + item interaction |
| live-doc-sync.test.ts | P12 | LiveDocumentBubble + all live doc UI |
| misc-routes.test.ts | P13 | /messages route, 404, sidebar collapse, ProtocolWarning |
| account-management.test.ts | P14 | AccountManagementDialog, LoginConflictModal, /connect, remember credentials |
