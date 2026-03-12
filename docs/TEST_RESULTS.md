# Citadel Workspaces — Systematic UI/UX Test Results

> **Date**: March 8, 2026  
> **Method**: Automated browser testing via headless Chrome against local dev (`http://localhost:5291/`)  
> **Backend**: tilt up (server:12349, internal-service:12345, UI:5291)

---

## Test 1: Landing Page (`/`)

**Screenshot**: [01_landing_page.png](test-screenshots/01_landing_page.png)

### ✅ Positives
- **Strong visual identity** — dark theme with quantum computer background image fits the "post-quantum security" brand perfectly
- **Clear headline** — "The World's First Post-Quantum Virtual Workspace" is bold and readable
- **CTA prominence** — "Login Workspace" (purple) and "Join Workspace" (white outline) buttons are clearly visible and appropriately styled
- **Secondary actions** — "Manage Accounts" and "Settings" are present but unobtrusive at the bottom
- **Icon usage** — buttons have appropriate icons (login arrow, users icon, gear icon)
- **Fast load** — page renders near-instantly

### ❌ Negatives / Bugs
- **BUG: Excessive vertical height** — the page extends well below the viewport with a large empty dark area beneath the background image. Content floats in the upper-middle, leaving ~40% of the viewport as dead space
- **Background image alignment** — the quantum computer image is right-aligned and gets cut off on narrower viewports. On the default viewport, the left side has large empty space
- **No vertical centering** — content sits at roughly the 40% mark instead of being vertically centered in the viewport
- **Missing brand/logo** — no app logo or icon in the top-left or header area
- **No loading indicator** — first load has no skeleton/spinner if the WASM client takes time to initialize

### 💡 Suggestions
- Vertically center the hero section content in the viewport
- Add a subtle gradient or pattern fill below the background image instead of empty dark space
- Consider a centered/wider background image or an abstract pattern that scales better
- Add an app logo mark alongside the headline
- Add a WASM loading indicator for slow connections

---

## Test 2: Login Overlay

**Screenshot**: [02_login_overlay.png](test-screenshots/02_login_overlay.png)

### ✅ Positives
- **Clean form layout** — Username, Password, Server Address fields are clearly labeled with placeholder text
- **Advanced Options toggle** — collapsible advanced options keeps the form simple by default
- **Connect button** — prominent purple CTA at the bottom
- **Back arrow** — small "‹" arrow provides clear way to return to landing page

### ❌ Negatives / Bugs
- **BUG: Generic error on failed login** — attempting login with unknown user shows "An unexpected error occurred" — not actionable
- **No visual dimming** — the overlay appears on top of the landing page but there's limited backdrop dimming
- **Escape key doesn't close** — pressing Escape does not dismiss the overlay, violating standard modal UX
- **No password visibility toggle** — password field has no eye icon to show/hide password
- **Server address format unclear** — placeholder says "workspace.example.com:12349" but doesn't clarify if protocol prefix is needed

### 💡 Suggestions
- Replace generic errors with specific messages: "User not found", "Invalid password", "Cannot connect to server"
- Add a password visibility toggle (eye icon)
- Add Escape key support to dismiss
- Clarify server address format with a tooltip or helper text

---

## Test 3: Join Workspace Overlay (Registration Flow)

**Screenshot**: [03_join_overlay.png](test-screenshots/03_join_overlay.png)

### ✅ Positives
- **Multi-step wizard** — clear 3-step flow: ServerConnect → SecuritySettings → Join
- **Step labels** — "CANCEL" and "NEXT" buttons clearly labeled
- **Info icons** — (?) tooltip icons next to fields for additional help
- **Optional fields marked** — "Workspace Password (Optional)" clearly indicates optional

### ❌ Negatives / Bugs
- **Step indicator missing** — no progress indicator (1/3, 2/3, 3/3) showing which step you're on
- **No back-from-step-2** — unclear if you can go back from security settings to server selection
- **Password confirmation** — the Join step requires confirming the password, but no strength indicator is shown
- **"Add a New Workspace" title** — the heading says "Add a New Workspace" which implies creating one, not joining. The Landing button says "Join Workspace" — inconsistent language

### 💡 Suggestions
- Add a step progress indicator (dots or numbered steps)
- Ensure consistent language: button says "Join" but overlay says "Add a New"
- Add password strength indicator in the Join step

---

## Test 4: Settings Modal

**Screenshot**: [04_settings_modal.png](test-screenshots/04_settings_modal.png)

### ✅ Positives
- **5 well-labeled tabs** — General, Connections, Appearance, Privacy, Permissions
- **Tab icons** — each tab has a distinctive icon for quick visual identification
- **Active tab styling** — purple highlight on active tab is clear
- **Profile section** — avatar upload area and Display Name field are clean and intuitive
- **Has X close button** — modal can be closed via X button

### ❌ Negatives / Bugs
- **UX: Settings at Landing page** — most settings (Connections, Permissions) make little sense when not connected to a workspace. The settings modal from the Landing page should either show limited options or indicate they require a connection
- **Avatar area too small** — "Click or drag to upload" area is small and could benefit from a larger drop zone
- **Save Changes button** — positioned at bottom-right but could be more prominent

### 💡 Suggestions
- Disable or hide workspace-specific tabs when accessed from Landing (not connected)
- Make avatar upload area larger with clearer visual affordance (dashed border, plus icon)

---

## Test 5: Manage Accounts Dialog

**Screenshot**: [05_manage_accounts.png](test-screenshots/05_manage_accounts.png)

### ✅ Positives
- **Clear empty state** — "No accounts found. Create an account to get started." is helpful
- **Has X close button** — easy to dismiss
- **Clean layout** — when populated, shows Active Sessions (green) and Saved Accounts sections

### ❌ Negatives / Bugs
- **UX: Dead end** — empty state says "Create an account to get started" but provides NO button or link to actually create one. Users must close this dialog and find the Join button separately
- **No context on where to go** — doesn't guide users toward the Join Workspace flow

### 💡 Suggestions
- Add a "Create Account" or "Join Workspace" button in the empty state
- Consider linking directly to the Join flow from this dialog

---

## Test 6: Workspace Page

**Screenshots**: [06_workspace_with_init_modal.png](test-screenshots/06_workspace_with_init_modal.png), [07_workspace_after_reload.png](test-screenshots/07_workspace_after_reload.png)

### ✅ Positives
- **Excellent sidebar hierarchy** — clean tree structure with Office/Room icons, expand/collapse arrows, and clear selection highlighting
- **MDX content rendering** — "Welcome to General" page renders beautifully with rich text, bold, italics, emojis, and section headers
- **Tab bar** — content area has tabs (e.g. "Default", "Chat") for switching between views
- **TopBar layout** — workspace name, "Leader" indicator, notification bell, and user avatar are well-positioned
- **Action menus** — three-dot buttons on sidebar nodes provide "Edit Office", "Admin Settings", "Add Child" options
- **Workspace switcher** — dropdown includes "Join New Workspace" and "Manage Accounts" options
- **User dropdown** — avatar click shows Profile, Settings, Exit to Landing, Sign Out — all clearly labeled with appropriate icons

### ❌ Negatives / Bugs
- **BUG: Initialize Workspace modal persists on every navigation** — after cancelling the modal, it reappears when navigating between pages (/messages → /workspace). State is not remembered
- **BUG: Cancel button behavior unclear** — Cancel dismisses the modal but doesn't prevent it from reappearing. Should either: (a) permanently dismiss, or (b) be removed if initialization is mandatory
- **UX: Modal blocks workspace access** — first-time users on an uninitialized workspace are blocked by this modal. If they don't have the master password, they're stuck
- **Sidebar sections below hierarchy** — "Direct Messages" and "Groups" sections at the bottom of the sidebar are good but have limited visibility when the hierarchy tree is tall
- **Content area icons hard to see** — action icons in the content toolbar area are small and may be hard to identify

### 💡 Suggestions
- Persist initialization modal dismissal state in localStorage or the connection session
- For non-admin users, auto-hide the init modal and show a "Workspace not initialized" info banner instead
- Consider making the "Direct Messages" and "Groups" sidebar sections more prominent or moveable

---

## Test 7: Messages Page (`/messages`)

### ✅ Positives
- **Standard chat layout** — peer list on left, conversation area on right — follows convention
- **Empty state** — "No conversation selected" with an instructive message
- **Peer presence** — contacts show online/offline status

### ❌ Negatives / Bugs
- **BUG: Init modal reappears** — navigating to /messages from workspace triggers the workspace initialization modal again
- **UX: No way to start a new conversation from this page** — must go to User Directory first to initiate connections
- **Sidebar disappears** — the Messages page lacks the full sidebar hierarchy. Users lose context of where they are in the workspace

### 💡 Suggestions
- Add a "New Message" or "Find People" button on the Messages page
- Consider keeping a minimal sidebar or breadcrumb for navigation context
- Remember init modal dismissal state

---

## Test 8: User Directory (`/directory`)

### ❌ Negatives / Bugs
- **BUG: Shows "0 members"** — despite a peer (Kathy McCooper) being visible in Messages, the directory shows 0 members. This is a data sync/loading issue
- **UX: No sidebar** — the Directory page has no sidebar or consistent navigation. Users must use browser back or type a URL to return to workspace
- **UX: Missing back button** — no clear way to return to the workspace from this page
- **Inconsistency with Messages page** — Messages sees peers but Directory doesn't. These should share the same member data source

### 💡 Suggestions
- Fix member listing — ensure directory pulls from the same member list as Messages
- Add consistent navigation (sidebar or at minimum a back button)
- Add search and filter functionality (All / Online / Offline tabs)

---

## Summary: Issue Priority Matrix

| Priority | Issue | Category |
|---|---|---|
| 🔴 **Critical** | Initialize Workspace modal persists across navigations | Bug |
| 🔴 **Critical** | User Directory shows 0 members (data sync issue) | Bug |
| 🟠 **High** | Generic "unexpected error" on failed login | UX |
| 🟠 **High** | No navigation back from Messages/Directory to workspace | UX |
| 🟠 **High** | Manage Accounts empty state is a dead end | UX |
| 🟡 **Medium** | Landing page excessive vertical height / dead space | UI |
| 🟡 **Medium** | Join overlay says "Add a New Workspace" vs button says "Join" | UX |
| 🟡 **Medium** | Escape key doesn't close overlays | UX |
| 🟡 **Medium** | No step indicator in registration wizard | UX |
| 🟢 **Low** | No password visibility toggle in login | UX |
| 🟢 **Low** | Settings tabs shown at Landing with no connection | UX |
| 🟢 **Low** | Missing app logo/brand mark on Landing page | UI |
| 🟢 **Low** | Avatar upload area too small in settings | UI |

---

## Pages Not Yet Tested

| Page | Reason |
|---|---|
| Group Chat (`/groups/:id`) | No groups exist yet — needs group creation first |
| File Manager (`?section=files`) | Not navigated to during this session |
| Node Create/Edit/Delete flows | Partially tested (action menus verified) |
| P2P Chat inline overlay | Needs two connected peers |
| Workspace Switching | Only one workspace available |
| Multi-tab behavior | Requires manual multi-tab testing |
| Connection retry/drop behavior | Requires server restart |
