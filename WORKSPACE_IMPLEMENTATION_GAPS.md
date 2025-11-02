# Workspace-Level Implementation Gaps

This document traces UI functionality to workspace datatypes/enums and their implementation status in the server kernel.

## Protocol Architecture Overview

The Citadel workspace system uses a layered protocol architecture where WorkspaceProtocol is a subprotocol inscribed within InternalServiceRequest messages:

### 1. InternalServiceRequest Layer (Base Transport Layer)
Handles core connectivity and P2P transport:
- **Authentication**: Connect, Register, Disconnect requests
- **P2P Operations**: openP2PConnection, sendP2PMessage via WASM client
- **Session Management**: Connection management, orphan sessions
- **Message Transport**: Carries subprotocols between peers via Message variant

### 2. WorkspaceProtocol Layer (Application Subprotocol)
A subprotocol inscribed within InternalServiceRequest::Message for peer-to-peer communication:
- **Sent via**: InternalServiceRequest::Message { peer_cid, message_contents }
- **Contains**: Serialized WorkspaceProtocolPayload (Request/Response)
- **Operations**: Workspace CRUD, Office/Room management, Member operations
- **Routing**: Server processes WorkspaceProtocolRequests, peers exchange WorkspaceProtocol messages

### Message Flow
1. Client creates WorkspaceProtocolPayload (e.g., CreateOffice request)
2. Serializes payload to bytes
3. Wraps in InternalServiceRequest::Message { peer_cid: server_cid, message_contents: bytes }
4. Server deserializes and processes WorkspaceProtocolRequest
5. Server responds with WorkspaceProtocolResponse via same Message mechanism
6. For P2P: Peers exchange WorkspaceProtocol messages (including chat subprotocol)

## Error Response Architecture

### Current State
- `WorkspaceProtocolResponse` enum has a generic `Error(String)` variant
- No structured error types to distinguish between different error conditions
- Frontend cannot easily determine error type (permissions, not found, validation, etc.)

### Proposed Enhancement
Similar to `InternalServiceResponse`, implement structured error responses:

```rust
pub enum WorkspaceProtocolResponse {
    // ... existing variants ...
    
    // Replace generic Error with specific error types:
    WorkspaceError(WorkspaceErrorResponse),
}

pub enum WorkspaceErrorResponse {
    PermissionDenied { action: String, resource: String },
    NotFound { resource_type: String, id: String },
    ValidationError { field: String, message: String },
    PasswordIncorrect { resource: String },
    AlreadyExists { resource_type: String, identifier: String },
    // ... other specific error types
}
```

## Workspace Operations Implementation Status

| UI Functionality | Transport | Request Type | Response Type | Handler Location | Persistence | Status | Notes |
|-----------------|-----------|--------------|---------------|------------------|-------------|---------|-------|
| Initialize Workspace | InternalService::Message → WorkspaceProtocol | `CreateWorkspace` | `Workspace` | `async_process_command.rs:54-77` | ✅ Yes - `save_workspaces()` | ✅ Implemented | Master password required |
| Load Workspace | InternalService::Message → WorkspaceProtocol | `GetWorkspace` | `Workspace` or `WorkspaceNotInitialized` | `async_process_command.rs:21-52` | N/A - Read only | ✅ Implemented | Returns `WorkspaceNotInitialized` if not found |
| Update Workspace | InternalService::Message → WorkspaceProtocol | `UpdateWorkspace` | `Workspace` | `async_process_command.rs:79-103` | ✅ Yes - `save_workspaces()` | ✅ Implemented | Master password required |
| Delete Workspace | InternalService::Message → WorkspaceProtocol | `DeleteWorkspace` | `Success(String)` | `async_process_command.rs:105-125` | ✅ Yes - `save_workspaces()` | ✅ Implemented | Master password required |

### Workspace CRUD Checklist
- [x] Create - Implemented with persistence
- [x] Read - Implemented  
- [x] Update - Implemented with persistence
- [x] Delete - Implemented with persistence
- [ ] Password change functionality not exposed in protocol
- [ ] Workspace switching (multiple workspaces) not implemented

## Office Operations Implementation Status

| UI Functionality | Transport | Request Type | Response Type | Handler Location | Persistence | Status | Notes |
|-----------------|-----------|--------------|---------------|------------------|-------------|---------|-------|
| Create Office | InternalService::Message → WorkspaceProtocol | `CreateOffice` | `Office` | `async_process_command.rs:128-153` | ✅ Yes - `save_domains()` | ✅ Implemented | MDX content support |
| Get Office | InternalService::Message → WorkspaceProtocol | `GetOffice` | `Office` | `async_process_command.rs:155-177` | N/A - Read only | ⚠️ JSON parsing | Returns JSON string, requires parsing |
| Update Office | InternalService::Message → WorkspaceProtocol | `UpdateOffice` | `Office` | `async_process_command.rs:179-204` | ✅ Yes - `save_domains()` | ✅ Implemented | MDX content support |
| Delete Office | InternalService::Message → WorkspaceProtocol | `DeleteOffice` | `Success(String)` | `async_process_command.rs:206-221` | ✅ Yes - `save_domains()` | ✅ Implemented | |
| List Offices | InternalService::Message → WorkspaceProtocol | `ListOffices` | `Offices(Vec<Office>)` | `async_process_command.rs:223-232` | N/A - Read only | ✅ Implemented | |

### Office CRUD Checklist
- [x] Create - Implemented with persistence
- [x] Read - Implemented (needs JSON parsing fix)
- [x] Update - Implemented with persistence  
- [x] Delete - Implemented with persistence
- [x] List - Implemented
- [ ] MDX content persistence validation needed
- [ ] Metadata field not used in implementation

## Room Operations Implementation Status

| UI Functionality | Transport | Request Type | Response Type | Handler Location | Persistence | Status | Notes |
|-----------------|-----------|--------------|---------------|------------------|-------------|---------|-------|
| Create Room | InternalService::Message → WorkspaceProtocol | `CreateRoom` | `Room` | `async_process_command.rs:235-260` | ✅ Yes - `save_domains()` | ✅ Implemented | MDX content support |
| Get Room | InternalService::Message → WorkspaceProtocol | `GetRoom` | `Room` | `async_process_command.rs:262-270` | N/A - Read only | ✅ Implemented | |
| Update Room | InternalService::Message → WorkspaceProtocol | `UpdateRoom` | `Room` | `async_process_command.rs:273-298` | ✅ Yes - `save_domains()` | ✅ Implemented | MDX content support |
| Delete Room | InternalService::Message → WorkspaceProtocol | `DeleteRoom` | `Success(String)` | `async_process_command.rs:300-315` | ✅ Yes - `save_domains()` | ✅ Implemented | |
| List Rooms | InternalService::Message → WorkspaceProtocol | `ListRooms` | `Rooms(Vec<Room>)` | `async_process_command.rs:317-330` | N/A - Read only | ✅ Implemented | Requires office_id |

### Room CRUD Checklist
- [x] Create - Implemented with persistence
- [x] Read - Implemented
- [x] Update - Implemented with persistence
- [x] Delete - Implemented with persistence
- [x] List - Implemented
- [ ] MDX content persistence validation needed
- [ ] Metadata field not used in implementation

## Member Operations Implementation Status

| UI Functionality | Transport | Request Type | Response Type | Handler Location | Persistence | Status | Notes |
|-----------------|-----------|--------------|---------------|------------------|-------------|---------|-------|
| Add Member | InternalService::Message → WorkspaceProtocol | `AddMember` | `Success(String)` | `async_process_command.rs:333-363` | ✅ Yes - `save_domains()` | ✅ Implemented | Can add to workspace/office/room |
| Get Member | InternalService::Message → WorkspaceProtocol | `GetMember` | `Member(User)` | `async_process_command.rs:365-382` | N/A - Read only | ✅ Implemented | Direct user lookup |
| Update Role | InternalService::Message → WorkspaceProtocol | `UpdateMemberRole` | `Success(String)` | `async_process_command.rs:384-408` | ✅ Yes - `save_users()` | ✅ Implemented | Workspace-level only |
| Update Permissions | InternalService::Message → WorkspaceProtocol | `UpdateMemberPermissions` | `Success(String)` | `async_process_command.rs:410-436` | ✅ Yes - `save_domains()` | ✅ Implemented | Add/Set/Remove operations |
| Remove Member | InternalService::Message → WorkspaceProtocol | `RemoveMember` | `Success(String)` | `async_process_command.rs:438-466` | ✅ Yes - `save_domains()` | ✅ Implemented | Can remove from workspace/office/room |
| List Members | InternalService::Message → WorkspaceProtocol | `ListMembers` | `Members(Vec<User>)` | `async_process_command.rs:468-542` | N/A - Read only | ⚠️ Parameter validation | Must specify exactly one of office_id or room_id |

### Member Management Checklist
- [x] Add member with role - Implemented with persistence
- [x] Get member details - Implemented
- [x] Update member role - Implemented with persistence
- [x] Update member permissions - Implemented with persistence
- [x] Remove member - Implemented with persistence
- [x] List members - Implemented with validation
- [ ] Invitation system not implemented (direct add only)
- [ ] Member metadata field not used
- [ ] No workspace-wide member listing (requires office/room)

## Authentication & Session Operations (InternalService Layer)

| UI Functionality | Transport | Request Type | Response Type | Handler Location | Persistence | Status | Notes |
|-----------------|-----------|--------------|---------------|------------------|-------------|---------|-------|
| User Registration | Direct InternalService | `Register` | `RegisterSuccess` | `websocket-service.ts:195` | ✅ Yes - Backend | ✅ Implemented | Creates new user account |
| User Login | Direct InternalService | `Connect` | `ConnectSuccess` | `websocket-service.ts:161` | N/A | ✅ Implemented | Establishes session |
| Logout | Direct InternalService | `Disconnect` | N/A | `websocket-service.ts:276` | N/A | ✅ Implemented | Ends session |
| Session Management | Direct InternalService | `ConnectionManagement` | `ConnectionManagementSuccess/Failure` | `websocket-service.ts:324` | ✅ Yes - LocalDB | ✅ Implemented | Orphan mode, claim sessions |

## P2P Operations (InternalService Layer)

| UI Functionality | Transport | Request Type | Response Type | Handler Location | Persistence | Status | Notes |
|-----------------|-----------|--------------|---------------|------------------|-------------|---------|-------|
| Open P2P Connection | Direct InternalService | WASM: `open_p2p_connection` | N/A | `websocket-service.ts:265` | N/A | ✅ Implemented | Establishes P2P channel |
| Send P2P Message | Direct InternalService | WASM: `send_p2p_message` | N/A | `websocket-service.ts:254` | ❌ No | ⚠️ Partial | Needs TypeScript binding to WASM |

## Message Operations Implementation Status

| UI Functionality | Transport | Request Type | Response Type | Handler Location | Persistence | Status | Notes |
|-----------------|-----------|--------------|---------------|------------------|-------------|---------|-------|
| Send Message (Server) | InternalService::Message → WorkspaceProtocol | `Message` | `Error(String)` | `async_process_command.rs:545-548` | N/A | ❌ Not Implemented | "Only peers may receive this type" |
| Send Message (P2P) | InternalService::Message → WorkspaceProtocol::Message → MessageProtocol | WorkspaceProtocol::Message { contents } | N/A | Not implemented | ❌ No | ❌ Not Implemented | Triple-nested protocols |

### Message System Checklist
- [ ] P2P messaging uses triple-nested protocols:
  1. InternalService::Message for P2P transport
  2. WorkspaceProtocol::Message inscribed within
  3. MessageProtocol (chat subprotocol) serialized in contents field
- [ ] TypeScript WASM bindings needed for `send_p2p_message`
- [ ] Message subprotocol already defined in `message-protocol.ts`
- [ ] Read receipts defined but not implemented
- [ ] Typing indicators defined but not implemented
- [ ] Message history/persistence not implemented

## TypeScript WASM Binding Gaps

| Missing Binding | Current State | Required Action | Notes |
|----------------|---------------|-----------------|-------|
| `sendP2PMessage` | Exists in `websocket-service.ts` but calls WorkspaceClient | Need to expose WASM client's `send_p2p_message` | WorkspaceClient wraps InternalServiceWasmClient |
| `openP2PConnection` | Exists in `websocket-service.ts` | Already working | Calls `client.openP2PConnection` |
| WASM client access | WorkspaceClient doesn't expose underlying WASM | Add getter method | Need `getWasmClient()` or similar |

## Persistence Validation

### Currently Persisted
1. **Workspaces** - Full CRUD with `save_workspaces()`
2. **Domains** (Offices/Rooms) - Full CRUD with `save_domains()`
3. **Users** - Create/Update/Delete with `save_users()`

### Not Persisted/Validated
1. **MDX Content** - Field exists but persistence not validated
2. **Metadata** - Field exists but not used in most operations
3. **Message History** - No persistence layer for messages

## UI Feature Gaps

### Not Implemented in Protocol
1. **Workspace Switching** - Single workspace model only
2. **Member Invitation** - Direct add only, no invitation workflow
3. **Account Management** - UI shows "coming soon"
4. **Password Change** - No protocol support for changing passwords
5. **Audit Logs** - No activity tracking
6. **Search** - No search functionality across entities

### Implementation Recommendations

1. **Error Response Enhancement**
   - Implement structured error types at Workspace protocol layer
   - Add request IDs to all responses for correlation
   - Include field-level validation errors

2. **P2P Messaging Implementation**
   - Fix TypeScript WASM bindings to expose `send_p2p_message`
   - Implement triple-protocol nesting:
     1. InternalService::Message for P2P transport between peers
     2. WorkspaceProtocol inscribed as message contents to server/peers
     3. MessageProtocol (chat) inscribed within WorkspaceProtocol::Message
   - Add message persistence layer in backend

3. **Missing Features Priority**
   - Member invitation system (high priority) - Workspace layer
   - Fix WASM P2P bindings (high priority) - InternalService layer
   - Password change functionality (high priority) - Workspace layer
   - Workspace switching (medium priority) - Both layers
   - Message persistence (medium priority) - Backend storage
   - Search functionality (low priority) - Workspace layer

4. **Testing Requirements with Playwright**
   - Test both protocol layers independently
   - Verify P2P connections at InternalService layer
   - Test message delivery through full stack
   - Persistence across session logout/login
   - CRUD operations for all entities
   - Permission validation for all operations
   - Error handling for all failure cases