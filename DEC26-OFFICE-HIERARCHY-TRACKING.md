# December 26 - Office Hierarchy & Admin Features Implementation

This document tracks the implementation of three interconnected features:
1. File-based workspace hierarchy with default templates
2. Admin visual indicators (golden avatar border, row badges)
3. Unified office/room Content + Chat tabs (reusing P2P components)

---

## Feature 1: File-Based Workspace Hierarchy with Default Templates

### Goal
Create a standardized directory structure where workspaces, offices, and rooms are defined by file/folder layout rather than JSON configuration. The system should:
- Infer hierarchy from directory structure
- Load MDX content from `CONTENT.mdx` files
- Apply sensible defaults for missing parameters (e.g., `chat_enabled: true`)
- Support multiple workspaces via subdirectories

### Directory Structure

```
./documents/defaults/
└── root/                           # workspace-name (default: "root")
    ├── workspace.json              # Optional: workspace-level overrides
    ├── Welcome/                    # office-name: "Welcome"
    │   ├── CONTENT.mdx             # Landing page content
    │   ├── office.json             # Optional: office-level overrides
    │   ├── general/                # room-name: "general"
    │   │   ├── CONTENT.mdx         # Room content
    │   │   └── room.json           # Optional: room-level overrides
    │   └── random/                 # room-name: "random"
    │       └── CONTENT.mdx
    └── Tutorials/                  # office-name: "Tutorials"
        ├── CONTENT.mdx
        ├── getting-started/
        │   └── CONTENT.mdx
        ├── workspace-basics/
        │   └── CONTENT.mdx
        └── advanced-features/
            └── CONTENT.mdx
```

### Implementation Checklist

#### Phase 1: Create Default Content Structure
- [ ] Create `./documents/defaults/root/` directory
- [ ] Create `Welcome/` office with landing page MDX
- [ ] Create `Welcome/general/` room with community guidelines
- [ ] Create `Welcome/random/` room with casual chat description
- [ ] Create `Welcome/announcements/` room with announcement format
- [ ] Create `Tutorials/` office with overview MDX
- [ ] Create `Tutorials/getting-started/` room
- [ ] Create `Tutorials/workspace-basics/` room
- [ ] Create `Tutorials/advanced-features/` room
- [ ] Create quality MDX content for each file

#### Phase 2: Server-Side Directory Parser
- [ ] Create `DirectoryParser` module in `citadel-workspace-server-kernel/src/config/`
- [ ] Implement function to scan base directory for workspace subdirectories
- [ ] Implement recursive office/room detection from directory structure
- [ ] Load `CONTENT.mdx` files and populate `mdx_content` field
- [ ] Support optional `office.json` and `room.json` for overrides
- [ ] Apply default values:
  - `chat_enabled: true` (default)
  - `rules: null` (default)
  - `description`: Inferred from first paragraph of CONTENT.mdx or directory name
- [ ] Add `content_base_dir` option to `kernel.toml`

#### Phase 3: Fallback Chain
- [ ] If `workspace_structure` JSON exists and is valid, use it (backward compatible)
- [ ] If `content_base_dir` is specified, parse directory structure
- [ ] Merge: Directory-parsed config merged with JSON overrides
- [ ] Log warnings for conflicts/missing content

#### Phase 4: Docker & Deployment
- [ ] Update `docker/workspace-server/Dockerfile` to COPY `./documents/` directory
- [ ] Update volume mounts in `docker-compose.yml` if needed
- [ ] Test that content is accessible inside container
- [ ] Verify hot-reload works for MDX file changes (if applicable)

#### Phase 5: Testing
- [ ] Unit test: Directory parser correctly identifies hierarchy
- [ ] Unit test: MDX content is loaded into entities
- [ ] Unit test: Default values are applied correctly
- [ ] Integration test: Server starts with directory-based config
- [ ] Integration test: Offices and rooms appear in UI

### Technical Details

**Rust Module: `src/config/directory_parser.rs`**

```rust
pub struct DirectoryConfig {
    pub workspaces: Vec<WorkspaceStructureConfig>,
}

impl DirectoryConfig {
    pub fn from_directory(base_path: &Path) -> Result<Self, String> {
        // 1. List subdirectories in base_path (each is a workspace)
        // 2. For each workspace dir, list subdirs (each is an office)
        // 3. For each office dir, list subdirs (each is a room)
        // 4. Load CONTENT.mdx from each level
        // 5. Load optional .json files for overrides
        // 6. Apply defaults
    }
}
```

**kernel.toml addition:**
```toml
# Option A: JSON file (existing, backward compatible)
workspace_structure = "./workspaces.json"

# Option B: Directory-based (new)
content_base_dir = "./documents/defaults"

# If both specified, JSON takes precedence, directory fills gaps
```

---

## Feature 2: Admin Visual Indicators

### Goal
Provide clear visual indication when a user has admin privileges:
1. **Golden border on avatar** (top-right profile) when user is admin on current workspace
2. **Admin badge/icon** on workspace rows in WorkspaceSwitcher for workspaces where user is admin

### Implementation Checklist

#### Phase 1: Get Admin Status from State
- [ ] Ensure `state.currentUser.role` is correctly populated from `GetUserPermissions` response
- [ ] Add `role` field to `StoredSession` type if not present
- [ ] Update `ConnectionManager` to store role when session is established
- [ ] Verify role is "Admin" (capital A, as serialized from Rust)

#### Phase 2: Golden Border on Avatar (TopBar)
- [ ] Create `AdminAvatar` component or modify Avatar usage in `TopBar.tsx`
- [ ] Add conditional styling: `ring-2 ring-amber-400` or `border-2 border-amber-400`
- [ ] Use subtle gradient: `ring-amber-400/80 ring-offset-1 ring-offset-[#252424]`
- [ ] Add tooltip: "Workspace Administrator"
- [ ] Test visual appearance on different backgrounds

#### Phase 3: Admin Badge on Workspace Rows (WorkspaceSwitcher)
- [ ] Update `StoredWorkspace` interface to include actual `role` from session
- [ ] Fetch role from stored session data (not hardcoded 'Member')
- [ ] Create `AdminBadge` component: small shield or crown icon
- [ ] Add badge next to username in workspace row when `role === 'Admin'`
- [ ] Use consistent amber/gold color: `text-amber-400`
- [ ] Position: Between username and role text, or after role text
- [ ] Add tooltip: "Administrator"

#### Phase 4: Styling
- [ ] Define CSS variables/Tailwind classes for admin indicators
- [ ] Ensure consistency across light/dark themes (if applicable)
- [ ] Consider animation: subtle pulse or glow for admin indicators

#### Phase 5: Testing
- [ ] Manual test: Create account, initialize workspace, verify golden border appears
- [ ] Manual test: Multiple workspaces, verify badge only on admin workspaces
- [ ] Integration test: Update `group-messaging.test.ts` to check for admin indicators
- [ ] Verify non-admin users don't see admin indicators

### Component Changes

**TopBar.tsx - Avatar with Admin Indicator:**
```tsx
const isAdmin = state.currentUser?.role === 'Admin';

<Avatar className={cn(
  "h-8 w-8",
  isAdmin && "ring-2 ring-amber-400 ring-offset-1 ring-offset-[#252424]"
)}>
  <AvatarFallback className="bg-[#444A6C] text-white">
    {userInitials}
  </AvatarFallback>
</Avatar>
```

**WorkspaceSwitcher.tsx - Admin Badge:**
```tsx
import { Shield } from "lucide-react";

// In workspace row:
<span className="text-xs text-gray-400 group-hover:text-gray-600">
  @{workspace.username}
  {workspace.role === 'Admin' && (
    <Shield className="inline-block w-3 h-3 ml-1 text-amber-400" title="Administrator" />
  )}
</span>
```

---

## Feature 3: Unified Office/Room Content + Chat Tabs

### Goal
Every office and room should have two tabs:
1. **Content Tab** - Rendered MDX/markdown (existing functionality)
2. **Chat Tab** - Group chat (reusing P2P chat components for DRY)

The chat experience should match P2P messaging: text, markdown, and live documents.

### Current State Analysis

`BaseOffice.tsx` already implements tabs when `chat_enabled` is true:
- Uses `@/components/ui/tabs` (Radix UI Tabs)
- Content tab shows MDX editor/renderer
- Chat tab shows `GroupChatView`

**Issue:** `GroupChatView` is a separate implementation from P2P chat components.

### Implementation Checklist

#### Phase 1: Abstract Shared Chat Components
- [ ] Identify common chat elements between `P2PChat.tsx` and `GroupChatView.tsx`:
  - Message input with markdown support
  - Message list/bubbles
  - Live document sharing
  - Typing indicators
  - Timestamp formatting
- [ ] Create shared components in `@/components/chat/shared/`:
  - `ChatInput.tsx` - Text input with markdown toolbar
  - `ChatMessageList.tsx` - Scrollable message container
  - `ChatMessage.tsx` - Individual message bubble
  - `LiveDocButton.tsx` - Button to create/share live docs
- [ ] Parameterize for P2P vs Group context

#### Phase 2: Refactor P2PChat to Use Shared Components
- [ ] Update `P2PChat.tsx` to use shared `ChatInput`
- [ ] Update `P2PChat.tsx` to use shared `ChatMessageList`
- [ ] Verify P2P messaging still works correctly
- [ ] Update `ChatTabBar.tsx` if needed for shared usage

#### Phase 3: Refactor GroupChatView to Use Shared Components
- [ ] Update `GroupChatView.tsx` to use shared `ChatInput`
- [ ] Update `GroupChatView.tsx` to use shared `ChatMessageList`
- [ ] Ensure group message protocol compatibility
- [ ] Add live document support to group chat (if not present)

#### Phase 4: Update BaseOffice/Room Content Tabs
- [ ] Ensure `BaseOffice.tsx` correctly shows tabs for all offices/rooms
- [ ] Verify `chat_channel_id` is set for entities with `chat_enabled: true`
- [ ] Test tab switching animation/behavior
- [ ] Verify chat persists when switching between Content and Chat tabs

#### Phase 5: Styling Consistency
- [ ] Ensure identical message bubble styling in P2P and Group chat
- [ ] Ensure identical input area styling
- [ ] Match timestamp and sender name formatting
- [ ] Test responsive behavior on mobile

#### Phase 6: Testing
- [ ] Manual test: Navigate to office, verify Content and Chat tabs
- [ ] Manual test: Send message in group chat, verify it appears
- [ ] Manual test: Create live document in group chat
- [ ] Integration test: Update tests to verify tab switching
- [ ] Integration test: Verify message sending works

### Shared Component Structure

```
src/components/chat/
├── shared/
│   ├── ChatInput.tsx           # Reusable input with markdown
│   ├── ChatMessageList.tsx     # Reusable message container
│   ├── ChatMessage.tsx         # Reusable message bubble
│   ├── LiveDocButton.tsx       # Live document creation
│   └── types.ts                # Shared types
├── GroupChatView.tsx           # Uses shared components
└── RetryableMessageSender.tsx  # Existing utility

src/components/p2p/
├── P2PChat.tsx                 # Uses shared components
├── ChatTabBar.tsx              # Tab navigation (may be shared)
└── ... (other P2P specific)
```

---

## Testing Strategy

### Unit Tests
- Directory parser functionality
- Role detection from permissions
- Shared chat component rendering

### Integration Tests
1. **Admin Flow Test** (`test:group` or new `test:admin`)
   - Create account
   - Initialize workspace (become admin)
   - Verify golden avatar border visible
   - Verify admin badge in workspace switcher
   - Create office (admin only)
   - Verify office appears with Content/Chat tabs
   - Send message in office chat
   - Verify message appears

2. **Multi-User Admin Test**
   - Create admin user
   - Create regular user
   - Verify admin sees admin indicators
   - Verify regular user does NOT see admin indicators

### Manual Testing Checklist
- [ ] Fresh workspace start shows default offices from directory structure
- [ ] Admin avatar has golden border
- [ ] Non-admin avatar has no special border
- [ ] Workspace switcher shows admin badge on admin workspaces
- [ ] Office has Content and Chat tabs
- [ ] Room has Content and Chat tabs
- [ ] Chat in office works (send/receive)
- [ ] Chat styling matches P2P chat

---

## Progress Summary

| Feature | Phase | Status | Notes |
|---------|-------|--------|-------|
| File-Based Hierarchy | 1 - Content | COMPLETE | Created Welcome/, Tutorials/ offices with CONTENT.md |
| File-Based Hierarchy | 2 - Parser | COMPLETE | `from_directory()` method in lib.rs |
| File-Based Hierarchy | 3 - Fallback | COMPLETE | Legacy workspace_structure still supported |
| File-Based Hierarchy | 4 - Docker | COMPLETE | Dockerfile copies documents/ directory |
| File-Based Hierarchy | 5 - Testing | COMPLETE | UI verified: Welcome, Tutorials offices load |
| Admin Indicators | 1 - State | COMPLETE | Role stored in StoredSession + propagated to workspace context |
| Admin Indicators | 2 - Avatar | COMPLETE | Golden ring on TopBar avatar (amber-400) |
| Admin Indicators | 3 - Badge | COMPLETE | Shield icon in WorkspaceSwitcher |
| Admin Indicators | 4 - Styling | COMPLETE | amber-400 color theme, ADMIN SETTINGS section |
| Admin Indicators | 5 - Testing | COMPLETE | UI verified: golden border + admin section visible |
| Content+Chat Tabs | 1 - Abstract | Not Started | BaseOffice already has tabs |
| Content+Chat Tabs | 2 - P2P Refactor | Not Started | |
| Content+Chat Tabs | 3 - Group Refactor | Not Started | |
| Content+Chat Tabs | 4 - BaseOffice | Not Started | |
| Content+Chat Tabs | 5 - Styling | Not Started | |
| Content+Chat Tabs | 6 - Testing | Not Started | |

---

## Dependencies

```
Feature 1 (Hierarchy) → Feature 3 (Tabs)
  └── Offices/rooms need to exist before tabs can be tested

Feature 2 (Admin) → Independent
  └── Can be implemented in parallel

Feature 3 (Tabs) → Partially depends on Feature 1
  └── Need offices to exist, but can test with existing config first
```

## Recommended Implementation Order

1. **Feature 2 (Admin Indicators)** - Independent, quick win for visibility
2. **Feature 1 Phase 1** - Create default content files
3. **Feature 3 Phases 1-3** - Abstract and refactor chat components
4. **Feature 1 Phases 2-4** - Server-side parser and deployment
5. **Feature 3 Phases 4-5** - Update BaseOffice and styling
6. **All Testing** - Comprehensive testing after implementation

---

*Last Updated: December 26, 2025*
