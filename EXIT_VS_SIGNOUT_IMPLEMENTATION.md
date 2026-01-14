# Exit vs Sign Out Implementation

## Overview

This document describes the implementation of two distinct logout behaviors in the Citadel Workspace application, similar to how Slack handles workspace management.

## Conceptual Model

### Exit to Landing
- **Behavior**: Returns user to landing page while keeping their session active
- **Session State**: Session remains active on the backend (becomes "orphaned" in UI terms)
- **Re-authentication**: NOT required - user can click workspace icon to instantly return
- **Use Case**: User wants to temporarily leave workspace but stay logged in
- **UX**: Shows confirmation modal explaining session will remain active

### Sign Out
- **Behavior**: Fully disconnects the session and removes it from storage
- **Session State**: Session is terminated on backend and removed from ConnectionManager
- **Re-authentication**: Required - user must enter credentials again
- **Use Case**: User wants to completely log out and end their session
- **UX**: No confirmation modal - direct action

## Architecture

### Component Structure

```
TopBar.tsx
├── User Avatar Dropdown Menu
│   ├── Profile (placeholder)
│   ├── Preferences (placeholder)
│   ├── Exit to Landing → Shows ExitConfirmModal
│   └── Sign out → Calls handleSignOut()
└── ExitConfirmModal (renders when showExitConfirm = true)
```

### Flow Diagrams

#### Exit to Landing Flow
```
User clicks "Exit to Landing"
    ↓
ExitConfirmModal appears
    ↓
User confirms exit
    ↓
handleExit() executes:
    - clearSelectedUser() (clears tab-specific selection)
    - navigate('/') (returns to landing page)
    - Shows toast: "Session still active"
    ↓
Landing page loads
    ↓
OrphanSessionsNavbar appears showing active workspace icon
    ↓
User clicks workspace icon
    ↓
handleNavigate() executes:
    - websocketService.claimSession(cid, true) ← CRITICAL FIX
    - connectionManager.setActiveSessionIndex()
    - WorkspaceService.setConnectionId()
    - WorkspaceService.loadWorkspace()
    - navigate('/office')
    ↓
User instantly returns to workspace (no re-auth)
```

#### Sign Out Flow
```
User clicks "Sign out"
    ↓
handleSignOut() executes:
    - Get current session from ConnectionManager
    - connectionManager.disconnect() (sends Disconnect request to backend)
    - connectionManager.removeSession() (removes from storage)
    - clearSelectedUser() (clears tab-specific selection)
    - navigate('/') (returns to landing page)
    - Shows toast: "Fully logged out"
    ↓
Landing page loads
    ↓
OrphanSessionsNavbar does NOT appear (no active sessions)
    ↓
User must click "Login Workspace" and re-authenticate
```

## Implementation Details

### Files Created

#### `citadel-workspaces/src/components/ExitConfirmModal.tsx`
**Purpose**: Confirmation dialog for Exit to Landing action

**Key Features**:
- Purple-themed modal matching app design
- Clear explanation that session remains active
- Helpful tip about instant reconnection
- Cancel and Confirm buttons

**Props**:
```typescript
interface ExitConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  userName: string;
  workspaceName?: string;
}
```

### Files Modified

#### `citadel-workspaces/src/components/layout/sidebar/TopBar.tsx`

**Changes**:
1. Added state for exit confirmation modal
2. Created `handleExit()` function (lines 56-66)
3. Modified `handleSignOut()` function (lines 68-110)
4. Added dropdown menu items for Exit and Sign Out
5. Rendered ExitConfirmModal component

**handleExit() Implementation**:
```typescript
const handleExit = () => {
  // Just navigate to landing page, keep session active
  clearSelectedUser();
  navigate('/');

  toast({
    title: "Returned to landing page",
    description: "Your session is still active. Click your workspace icon to return instantly.",
    className: "bg-[#343A5C] border-purple-800 text-purple-200",
  });
};
```

**handleSignOut() Implementation**:
```typescript
const handleSignOut = async () => {
  try {
    const currentSession = connectionManager.getTabSelectedSession();

    if (!currentSession) {
      console.error('TopBar: No current session found');
      toast({
        title: "Sign out failed",
        description: "No active session found",
        variant: "destructive",
      });
      return;
    }

    console.log('TopBar: Fully signing out user', currentSession.username);

    // Full disconnect via WebSocket
    await connectionManager.disconnect();

    // Remove the session completely from stored sessions
    await connectionManager.removeSession(currentSession.username, currentSession.serverAddress);

    // Clear tab-specific user selection
    clearSelectedUser();

    // Navigate to landing page
    navigate('/');

    toast({
      title: "Signed out",
      description: "You have been fully logged out. You'll need to login again to access this workspace.",
      className: "bg-[#343A5C] border-purple-800 text-purple-200",
    });
  } catch (error) {
    console.error('TopBar: Sign out failed', error);
    toast({
      title: "Sign out failed",
      description: "An error occurred while signing out",
      variant: "destructive",
    });
  }
};
```

#### `citadel-workspaces/src/lib/websocket-service.ts` (lines 276-295)

**Bug Fix**: BigInt serialization error in disconnect()

**Problem**:
```typescript
// ❌ BROKEN - Cannot serialize BigInt to JSON
cid: BigInt(cid)
```

**Solution**:
```typescript
// ✅ FIXED - Send as string, Rust parses to u64
cid: cid
```

**Full Implementation**:
```typescript
async disconnect(cid?: string): Promise<void> {
  await this.init();
  if (cid) {
    try {
      const request = {
        Disconnect: {
          request_id: crypto.randomUUID(),
          cid: cid  // Send as string
        }
      };
      debugLog('websocket', 'Sending Disconnect request', request);
      await this.client.sendDirectToInternalService({ Request: request } as any);
    } catch (error) {
      errorLog('Error disconnecting:', error);
      throw error; // Re-throw so caller knows disconnect failed
    }
  }
}
```

#### `citadel-workspaces/src/components/OrphanSessionsNavbar.tsx`

**Critical Bug Fix**: Missing claimSession() call prevented orphan session reconnection

**Problem**:
The handleNavigate() function was setting the connection ID and loading workspace WITHOUT claiming ownership of the orphaned session first. This caused the backend to reject the workspace operations.

**Solution**:
Added `await websocketService.claimSession(session.cid, true)` before navigating to workspace.

**Implementation** (lines 69-115):
```typescript
const handleNavigate = async (session: OrphanSessionWithWorkspace) => {
  try {
    console.log('OrphanSessionsNavbar: Claiming orphan session and navigating to workspace:', session.workspaceName);

    // Show loading toast
    toast({
      title: "Reconnecting...",
      description: `Claiming session for ${session.workspaceName}`,
      className: "bg-[#343A5C] border-purple-800 text-purple-200",
    });

    // ✅ CRITICAL FIX: Claim the orphan session (take ownership)
    const claimResult = await websocketService.claimSession(session.cid, true);
    console.log('OrphanSessionsNavbar: Session claimed successfully:', claimResult);

    const connectionManager = ConnectionManager.getInstance();

    // Set the active session index
    if (session.storedSessionIndex >= 0) {
      await connectionManager.setActiveSessionIndex(session.storedSessionIndex);
    }

    // Set the connection ID in WorkspaceService
    WorkspaceService.setConnectionId(session.cid);

    // Trigger workspace loading
    WorkspaceService.loadWorkspace();
    WorkspaceService.listOffices();

    // Navigate to the office page
    navigate('/office');

    // Show success toast
    toast({
      title: "Connected!",
      description: `Now viewing ${session.workspaceName}`,
      className: "bg-[#343A5C] border-purple-800 text-purple-200",
    });
  } catch (error) {
    console.error('OrphanSessionsNavbar: Failed to navigate to workspace:', error);
    toast({
      title: "Connection Failed",
      description: "Could not reconnect to workspace. Please try logging in again.",
      variant: "destructive",
    });
  }
};
```

## Key Technical Concepts

### Orphan Sessions
In Citadel Workspace, an "orphaned" session is simply an active backend session that doesn't currently have a UI connection. This happens when:
- User clicks "Exit to Landing"
- User closes the browser tab/window (depending on orphan mode settings)
- Network temporarily disconnects

Orphaned sessions remain authenticated on the backend and can be reclaimed without re-entering credentials.

### Session Claiming Protocol
The `claimSession()` method sends a ConnectionManagement request to take ownership of an orphaned session:

```typescript
async claimSession(sessionCid: string | bigint, onlyIfOrphaned: boolean = false): Promise<any> {
  await this.init();
  const request = {
    ConnectionManagement: {
      request_id: crypto.randomUUID(),
      operation: {
        ClaimSession: {
          session_cid: sessionCid.toString(),
          only_if_orphaned: onlyIfOrphaned
        }
      }
    }
  };

  const response = await this.sendRequest(request);
  return response;
}
```

**Parameters**:
- `session_cid`: The connection ID of the session to claim
- `only_if_orphaned`: If true, only claim if session is currently orphaned (recommended)

### Session Removal
The `removeSession()` method in ConnectionManager removes a session from local storage:

```typescript
async removeSession(username: string, serverAddress: string): Promise<void> {
  const sessions = this.getStoredSessions();
  const index = sessions.sessions.findIndex(
    s => s.username === username && s.serverAddress === serverAddress
  );

  if (index !== -1) {
    sessions.sessions.splice(index, 1);
    await this.saveStoredSessions(sessions);
  }
}
```

## Testing Guide

### Test Exit to Landing Flow

1. **Setup**: Create test account and log in
   ```
   Use create-account agent
   ```

2. **Enter workspace**: Verify you're in the office view with workspace loaded

3. **Click Exit**:
   - Click user avatar in top-right
   - Click "Exit to Landing"
   - Verify ExitConfirmModal appears
   - Read modal text - should mention staying logged in

4. **Confirm Exit**:
   - Click "Exit to Landing" button
   - Should see toast: "Returned to landing page"
   - Landing page should load

5. **Verify Active Session Navbar**:
   - Top of landing page should show "Active Workspaces:" navbar
   - Should see workspace icon with first letter of username

6. **Reconnect**:
   - Click workspace icon
   - Should see toast: "Reconnecting... Claiming session for {username}"
   - Should see toast: "Connected! Now viewing {username}"
   - Should navigate to /office
   - Workspace should load WITHOUT password prompt

7. **Verify Workspace State**:
   - Check that workspace data loaded correctly
   - Verify offices list appears
   - Confirm you can interact with workspace normally

### Test Sign Out Flow

1. **Setup**: From workspace view (after Exit test or fresh login)

2. **Click Sign Out**:
   - Click user avatar in top-right
   - Click "Sign out"
   - No confirmation modal should appear (direct action)

3. **Verify Disconnect**:
   - Should see toast: "Signed out... You have been fully logged out"
   - Landing page should load
   - Active Workspaces navbar should NOT appear
   - No workspace icons visible

4. **Verify Session Removed**:
   - Check backend logs: `tilt logs internal-service`
   - Should see Disconnect request received
   - Should see session cleanup logs

5. **Attempt Reconnect**:
   - Click "Login Workspace" button
   - Should prompt for username/password
   - Cannot access workspace without re-authentication

### Expected Backend Logs

**Exit to Landing** (no disconnect):
```
[No disconnect logs - session remains active]
```

**Sign Out** (full disconnect):
```
[INFO] Received InternalServiceRequest: Disconnect
[INFO] Disconnecting session CID: 123456789
[INFO] Cleaning up connection resources
[INFO] Session 123456789 removed from server_connection_map
```

## Troubleshooting

### Issue: Orphan session icon appears but reconnection fails

**Symptom**: Clicking workspace icon shows "Loading..." then redirects to /connect

**Cause**: Missing or failed claimSession() call

**Solution**:
- Check browser console for errors in OrphanSessionsNavbar
- Verify claimSession() is being called before setConnectionId()
- Check network tab for ConnectionManagement request

### Issue: Exit button doesn't show confirmation modal

**Symptom**: Clicking "Exit to Landing" immediately navigates without modal

**Cause**: ExitConfirmModal not rendering or state not updating

**Solution**:
- Verify `showExitConfirm` state is being set to true
- Check that ExitConfirmModal is rendered in TopBar JSX
- Verify `open` prop is correctly bound to state

### Issue: Sign out doesn't remove session

**Symptom**: After sign out, active session navbar still appears

**Cause**: removeSession() not being called or failing silently

**Solution**:
- Add console.log in handleSignOut to verify execution
- Check that currentSession exists before calling removeSession
- Verify ConnectionManager.removeSession() completes successfully

### Issue: BigInt serialization error on disconnect

**Symptom**: JavaScript error: "Do not know how to serialize a BigInt"

**Cause**: Passing BigInt(cid) instead of string to disconnect()

**Solution**:
- In websocket-service.ts disconnect(), use `cid: cid` not `cid: BigInt(cid)`
- Backend expects string and parses to u64 internally

## User Experience Flow

### Scenario 1: Quick Break
```
User working in workspace
    ↓
Needs to check email quickly
    ↓
Clicks "Exit to Landing"
    ↓
Confirms in modal
    ↓
Returns to landing page (session still active)
    ↓
Checks email in another tab
    ↓
Clicks workspace icon on landing page
    ↓
Instantly returns to workspace (no password)
```

### Scenario 2: End of Day
```
User finishing work
    ↓
Wants to fully log out
    ↓
Clicks "Sign out"
    ↓
Immediately logs out
    ↓
Returns to landing page (no active sessions)
    ↓
Closes browser
    ↓
Next day: Must re-authenticate to access workspace
```

## Security Considerations

### Exit to Landing
- Session remains authenticated on backend
- Session ID stored in ConnectionManager (localStorage)
- Vulnerable to XSS if attacker can access localStorage
- Mitigated by HTTPS, CSP headers, and secure session management

### Sign Out
- Fully terminates backend session
- Removes session from localStorage
- Sends explicit Disconnect request to backend
- Backend cleans up all session resources
- More secure for shared computers or public networks

### Recommendations
- Use "Exit to Landing" for trusted personal devices
- Use "Sign out" for shared computers or public networks
- Consider adding auto-logout timeout for orphaned sessions
- Consider adding session revocation from backend admin panel

## Future Enhancements

### Potential Improvements
1. **Auto-logout timeout**: Automatically disconnect orphaned sessions after X hours
2. **Session management panel**: Show all active sessions with ability to revoke remotely
3. **Device tracking**: Show which device each session is from
4. **Force disconnect**: Admin ability to force disconnect any session
5. **Session activity log**: Track when sessions were created, claimed, disconnected
6. **Multi-workspace support**: Handle multiple workspace sessions simultaneously

### Code Quality
1. **Error boundary**: Add error boundary around OrphanSessionsNavbar
2. **Loading states**: Add skeleton loading for session list
3. **Retry logic**: Add retry with exponential backoff for claimSession failures
4. **Optimistic UI**: Show workspace loading immediately, rollback on error
5. **Analytics**: Track Exit vs Sign Out usage patterns

## References

### Related Files
- `citadel-workspaces/src/components/ExitConfirmModal.tsx`
- `citadel-workspaces/src/components/layout/sidebar/TopBar.tsx` (lines 56-110)
- `citadel-workspaces/src/components/OrphanSessionsNavbar.tsx` (lines 69-115)
- `citadel-workspaces/src/lib/websocket-service.ts` (lines 276-295, 410-471)
- `citadel-workspaces/src/lib/connection-manager.ts` (line 991)

### Backend Protocol
- **InternalServiceRequest::Disconnect**: Terminates session
- **InternalServiceRequest::ConnectionManagement::ClaimSession**: Claims orphaned session
- **Session lifecycle**: Connect → Active → Orphaned → Claimed or Disconnected

### Related Documentation
- `citadel-internal-service/REQUESTS.md`: Internal service request types
- `citadel-internal-service/RESPONSES.md`: Internal service response types
- `CLAUDE.md`: Session management and resource cleanup guidelines
