# Testing Workspace Switching

## Overview
The workspace switching functionality has been implemented. Users can now switch between multiple workspace connections seamlessly.

## Implementation Details

### What Was Changed

1. **WorkspaceSwitcher Component** (`src/components/layout/sidebar/WorkspaceSwitcher.tsx`)
   - Now shows actual stored sessions instead of hardcoded workspaces
   - Each workspace displays username and server address
   - Active workspace has a green indicator dot
   - Switching workspaces disconnects current connection and connects to the selected one

2. **ConnectionManager** (`src/lib/connection-manager.ts`)
   - Added `reconnectToStoredSessions()` method for workspace switching
   - Added `setActiveSessionIndex()` to update which session is active
   - Properly updates connection status on failures

3. **WorkspaceLoader** (`src/components/ui/workspace-loader.tsx`)
   - Added timeout mechanism (5 seconds) before redirecting to connect page
   - Shows "Checking connection..." after timeout
   - Provides manual "Go to Connect" button

## How to Test Multiple Workspaces

### Step 1: Open Two Browser Tabs
1. Open http://localhost:5173 in Tab 1
2. Open http://localhost:5173 in Tab 2

### Step 2: Connect Different Users
**Tab 1:**
- Click "Connect to Workspace"
- Use credentials: `admin2` / `admin123`
- Complete connection

**Tab 2:**
- Click "Connect to Workspace"  
- Use credentials: `roomadmin` / `roomadmin123`
- Complete connection

### Step 3: Test Workspace Switching
1. In either tab, click on the workspace name in the top-left corner
2. You should see the other workspace listed
3. Click on it to switch
4. The UI will fade out, disconnect, and reconnect to the selected workspace

### Features

- **Visual Feedback**: Loading spinner during switch
- **Route Preservation**: Remembers your location in each workspace
- **Active Indicator**: Green dot shows which workspace is currently active
- **Toast Notifications**: Success/failure messages during switching
- **Add New Workspace**: "JOIN NEW WORKSPACE" option to connect to additional workspaces

## Current Users Available

1. **admin2** (password: admin123) - Admin role
2. **wsadmin** (password: wsadmin123) - Admin role  
3. **roomadmin** (password: roomadmin123) - Admin role

All users are connected to the same server (127.0.0.1:12349) but maintain separate workspace sessions.

## Next Steps

1. Test room creation in each workspace
2. Test peer connections between workspaces
3. Verify data isolation between workspace sessions