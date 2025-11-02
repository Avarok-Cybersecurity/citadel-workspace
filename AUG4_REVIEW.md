# Citadel Workspace P2P Functionality Review - August 4, 2025

## Executive Summary

This comprehensive review of the Citadel Workspace P2P functionality identifies key areas for improvement to enable robust peer-to-peer communication. The focus is on stabilizing and clarifying the existing framework to accelerate the development iteration cycle. Primary areas of attention include proper session state management across tabs, P2P registration workflow definition, and connection resilience.

**Development Approach**: All development must use the **workspace-developer agent** and follow browser-driven development with Playwright verification at each step.

**Acceptance Criteria**: Two users in different browser tabs must be able to:
1. See each other in peer lists
2. Complete mutual registration
3. Establish P2P connection
4. Successfully exchange messages

## Test Environment

- **Services Running**: 
  - Server: `citadel-workspace-server` on port 12349
  - Internal Service: `citadel-workspace-internal-service` on port 12345
  - UI: Vite dev server on port 5173 (with HMR enabled)
- **Docker Containers**: Both server and internal-service containers running and healthy
- **Development Note**: HMR is now enabled for Vite. Service restarts should be done sparingly as they cause state loss, which hampers development progress

## Functionality Assessment

### ✅ What Works

1. **User Registration**
   - Users can successfully register with the workspace
   - CIDs are generated and assigned correctly
   - Profile creation flow works as expected
   - Security settings can be configured

2. **Basic UI Components**
   - P2P messaging UI components exist (`P2PChat.tsx`, `P2PPeerList.tsx`)
   - Navigation and routing work correctly
   - WebSocket connections establish successfully
   - WASM client loads and initializes properly

3. **Service Infrastructure**
   - Tilt orchestration works correctly
   - Docker containers run without errors
   - Hot reloading is functional
   - WASM build and sync process works

### ❌ What Doesn't Work

1. **Session State Management Across Tabs**
   - **Issue**: Tabs are sharing selected user state instead of just data
   - **Impact**: Cannot have different users logged in across tabs while sharing data
   - **Evidence**: Both tabs show "User One" even after registering "User Two"
   - **Root Cause**: Need to separate "selected state" from "synchronized data"
   - **Desired Behavior**: 
     - Data should be synchronized across tabs (via BroadcastChannel)
     - Each tab should maintain its own selected user context
     - Multiple users can coexist across different tabs
     - Same user in multiple tabs should share the same data

2. **P2P Discovery and Listing**
   - **Issue**: Peer discovery commands (`ListAllPeers`) are not properly exposed
   - **Impact**: Users cannot see other online peers
   - **Evidence**: "No members yet" shown in workspace members list
   - **Root Cause**: Missing implementation in UI to call peer discovery APIs

3. **P2P Registration Workflow**
   - **Issue**: P2P registration workflow not properly defined in UI
   - **Impact**: Users cannot complete mutual registration for P2P communication
   - **Evidence**: P2PRegistrationService exists but workflow unclear
   - **Required Flow**:
     - User A sends `PeerRegister` request to User B
     - User B must also send `PeerRegister` request to User A (mutual registration)
     - After mutual registration, either party can initiate `PeerConnect`
     - Connection establishment enables P2P messaging
   - **Root Cause**: Missing UI workflow and abstractions for registration process

4. **P2P Messaging**
   - **Issue**: P2P message sending fails due to missing WASM bindings
   - **Impact**: Messages cannot be sent between peers
   - **Evidence**: `send_p2p_message` WASM function not properly exposed
   - **Root Cause**: Incomplete WASM client implementation

5. **Internal Service Connection Modal**
   - **Issue**: Connection failure modal needs improvements
   - **Impact**: Poor user experience when connection fails
   - **Evidence**: Modal shown in `.playwright-mcp/internal-service-dcd.png`
   - **Required Fixes**:
     - Loading bar should be indeterminate (not countdown)
     - "Retry Now" button should call `.restart()` on wasmModule
     - Better error messaging for connection issues

## Detailed Technical Issues

### 1. Tab State vs. Data Synchronization
```javascript
// Current problem: Selected state is synchronized
- Each tab needs independent selected user context
- Data for same user should sync across tabs
- Different users in different tabs should coexist
```

### 2. Missing P2P UI Integration
```typescript
// P2PRegistrationService exists but needs workflow
- Need UI for mutual registration flow
- Visual feedback for registration status
- Connection status indicators per peer
```

### 3. Protocol Layer Organization
The triple-nested protocol structure is actually elegant and provides proper separation of concerns:
```
InternalServiceRequest::Message (Transport Layer)
  └── WorkspaceProtocol::Message (Application Layer)
      └── MessageProtocol (Chat Subprotocol)
```

**Proposed Organization**: Create a unified sending layer with handles:
```typescript
protocol.senders().internalService(); // Base transport
protocol.senders().workspace();       // Calls internalService() internally
protocol.senders().p2p();            // Calls workspace() internally
                                     // Direct WASM calls for open_p2p_connection
                                     // and send_p2p_message operations
```

### 4. WASM Binding Issues
```typescript
// WorkspaceClient.ts
async openP2PConnection(peerCid: string): Promise<void>
// Missing: proper error handling and status feedback

send_p2p_message() 
// Not fully exposed through WASM interface
```

## Browser-Driven Development Checklist

### Phase 0: DX Stability ✅ COMPLETED

- [x] **Fix Service Auto-Reloading** 
  - [x] Modified Tiltfile to use `TRIGGER_MODE_MANUAL` for server and internal-service
  - [x] Services now only restart when explicitly triggered via `tilt trigger <service>`
  - [x] Preserves in-memory state during development
  - **To restart services manually**: `tilt trigger server` or `tilt trigger internal-service`
  - **Note**: Only restart when absolutely necessary (e.g., Rust code changes)

### Phase 1: Tab State Isolation ✅ Browser Verification Required

- [ ] **Fix Tab State Management** (workspace-developer agent)
  - [ ] Modify `broadcast-channel-service.ts` to separate selected state from data
  - [ ] **Playwright Test**: Open 2 tabs, register User One and User Two
  - [ ] **Verify**: Tab 1 header shows "User One"
  - [ ] **Verify**: Tab 2 header shows "User Two"
  - [ ] **Verify**: Same user data syncs across tabs when logged in twice

### Phase 2: Peer Discovery Implementation ✅ Browser Verification Required

- [ ] **Implement P2P Discovery UI** (workspace-developer agent)
  - [ ] Add ListAllPeers button in workspace UI
  - [ ] Display peer list with CIDs and usernames
  - [ ] **Playwright Test**: Click "Discover Peers" in both tabs
  - [ ] **Verify**: User One sees User Two in peer list
  - [ ] **Verify**: User Two sees User One in peer list
  - [ ] **Verify**: Online status indicators work correctly

### Phase 3: P2P Registration Workflow ✅ Browser Verification Required

- [ ] **Create Registration UI Flow** (workspace-developer agent)
  - [ ] Add "Register with Peer" button in peer list
  - [ ] Implement registration request modal
  - [ ] **Playwright Test**: User One clicks register for User Two
  - [ ] **Verify**: Registration notification appears for User Two
  - [ ] **Playwright Test**: User Two accepts and reciprocates
  - [ ] **Verify**: Both users show "Registered" status
  - [ ] **Verify**: PeerConnect option becomes available

### Phase 4: P2P Connection Establishment ✅ Browser Verification Required

- [ ] **Implement Connection Flow** (workspace-developer agent)
  - [ ] Add "Connect" button for registered peers
  - [ ] Fix WASM bindings for `open_p2p_connection`
  - [ ] **Playwright Test**: User One clicks "Connect" to User Two
  - [ ] **Verify**: Connection status changes to "Connecting..."
  - [ ] **Verify**: Both users show "Connected" status
  - [ ] **Verify**: Chat interface becomes active

### Phase 5: P2P Messaging ✅ Browser Verification Required

- [ ] **Complete Message Sending** (workspace-developer agent)
  - [ ] Fix WASM `send_p2p_message` binding
  - [ ] Implement message UI updates
  - [ ] **Playwright Test**: User One types "Hello User Two" and sends
  - [ ] **Verify**: Message appears in User One's chat (sent status)
  - [ ] **Verify**: Message appears in User Two's chat
  - [ ] **Playwright Test**: User Two replies "Hi User One"
  - [ ] **Verify**: Reply appears in both chats
  - [ ] **Verify**: Message status indicators work (sent/delivered/read)

### Phase 6: Connection Resilience ✅ Browser Verification Required

- [ ] **Fix Connection Modal** (workspace-developer agent)
  - [ ] Make progress bar indeterminate
  - [ ] Wire "Retry Now" to `wasmModule.restart()`
  - [ ] **Playwright Test**: Stop internal-service container
  - [ ] **Verify**: Connection failed modal appears
  - [ ] **Verify**: Progress bar is indeterminate (not countdown)
  - [ ] **Playwright Test**: Click "Retry Now"
  - [ ] **Verify**: Connection re-establishes

### Medium Priority Improvements

- [ ] **Implement Protocol Sending Layer**
  - Create organized sending layer with handles
  - `protocol.senders().internalService()` for base transport
  - `protocol.senders().workspace()` wraps in workspace protocol
  - `protocol.senders().p2p()` for P2P messaging with proper nesting
  - Direct WASM calls for P2P connection operations

- [ ] **Add P2P Status Dashboard**
  - Show current user CID prominently
  - Display connection status for each peer
  - Add message delivery indicators
  - Show typing indicators in real-time

- [ ] **Improve Error Handling**
  - Add user-friendly error messages
  - Implement retry mechanisms for failed connections
  - Add connection timeout handling

### Low Priority Enhancements

- [ ] **Add P2P Testing Mode**
  - Create test harness for P2P functionality
  - Add mock peer simulation
  - Implement automated P2P tests

- [ ] **Documentation Updates**
  - Document P2P registration flow
  - Add troubleshooting guide
  - Create P2P API reference

## Testing Recommendations

1. **Immediate Testing Needs**:
   - Test with multiple tabs to verify proper state isolation
   - Ensure data synchronization works for same user across tabs
   - Verify different users can coexist in different tabs
   - Monitor WebSocket messages in browser DevTools

2. **Test Scenarios to Implement**:
   - Peer discovery with 3+ users
   - Message delivery confirmation
   - Connection recovery after disconnect
   - Concurrent P2P sessions

## Development Notes

- **Workspace Password**: The correct workspace master password is `SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME` (defined in `./docker/workspace-server/kernel.toml`)
- **HMR Enabled**: Vite now has HMR enabled for faster iteration
- **State Preservation**: Avoid restarting services unnecessarily to maintain state

## Conclusion

The P2P functionality has a solid architectural foundation with elegant protocol separation. The focus should be on stabilizing the existing framework and improving the development iteration cycle. Key priorities are proper tab state management (synchronized data with independent selected states), defining clear P2P registration workflows, and improving connection resilience.

## Next Steps

1. **Immediate**: Implement proper tab state isolation while maintaining data sync
2. **Short-term**: Define and implement P2P registration workflow UI
3. **Medium-term**: Complete WASM bindings and protocol sending layer
4. **Long-term**: Add comprehensive testing and improve connection resilience

## Technical Debt

- Tab state management needs separation from data synchronization
- P2P registration workflow needs clear UI abstractions
- WASM client needs complete P2P function exposure
- Connection failed modal needs UX improvements
- No automated tests for P2P functionality

---

*Review conducted on August 4, 2025*
*Tilt services active with HMR enabled*
*Focus on stabilization and development velocity*