# Citadel Workspace Architecture

## System Overview

The Citadel Workspace is a multi-layered protocol system for secure, peer-to-peer collaborative workspaces. It uses a three-tier architecture: UI Layer (React/TypeScript), WASM Client Layer, and Backend Services (Rust).

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI Layer (React/TypeScript)              │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────────────┐ │
│  │ Workspace UI │  │ P2P Discovery  │  │ Messaging UI       │ │
│  └──────┬───────┘  └────────┬───────┘  └─────────┬──────────┘ │
└─────────┼──────────────────┼────────────────────┼──────────────┘
          │                   │                     │
          │                   v                     v
          │         ┌─────────────────────────────────────┐
          │         │   TypeScript Client Bindings       │
          │         │   (citadel-workspace-client-ts)     │
          │         └─────────────────────────────────────┘
          │                   │                     │
          v                   v                     v
┌─────────────────────────────────────────────────────────────────┐
│                    WASM Client Layer                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │   citadel-internal-service-wasm-client                   │  │
│  │   - send_direct_to_internal_service()                    │  │
│  │   - send_p2p_message()                                   │  │
│  │   - open_p2p_connection()                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          │                                            │
          │ WebSocket (localhost:12346)                │ WebSocket
          v                                            v
┌─────────────────────────────────────────────────────────────────┐
│              Internal Service (Rust Backend)                    │
│              citadel-internal-service (Port 12345)              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  CitadelWorkspaceService                                 │  │
│  │  - server_connection_map: HashMap<u64, Connection>       │  │
│  │  - tcp_connection_map: HashMap<Uuid, ResponseSender>     │  │
│  │  - orphan_sessions: HashMap<Uuid, bool>                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│         │                                                │       │
│         │  InternalServiceRequest                       │       │
│         v                                                v       │
│  ┌──────────────┐                             ┌──────────────┐ │
│  │   Connect    │                             │ PeerRegister │ │
│  │   Register   │                             │ PeerConnect  │ │
│  │   Disconnect │                             │   Message    │ │
│  └──────────────┘                             └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
          │                                            │
          │ Citadel SDK                                │ P2P Direct
          v                                            v
┌─────────────────────────────────────────────────────────────────┐
│           Workspace Server Kernel (Rust Backend)                │
│           citadel-workspace-server-kernel (Port 12349)          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  WorkspaceProtocol Handler                               │  │
│  │  - CreateWorkspace, GetWorkspace, UpdateWorkspace        │  │
│  │  - CreateOffice, ListOffices, UpdateOffice               │  │
│  │  - CreateRoom, ListRooms, UpdateRoom                     │  │
│  │  - AddMember, ListMembers, UpdateMemberRole              │  │
│  │  - Message (P2P chat subprotocol)                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              v                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Backend Storage (In-Memory with Persistence)            │  │
│  │  - Workspaces, Offices, Rooms                            │  │
│  │  - Users, Permissions                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Protocol Layer Explanation

### Layer 1: InternalServiceRequest (Transport Layer)

**Purpose**: Handles core connectivity, authentication, and P2P transport.

**Handled By**: `citadel-internal-service`

**Key Operations**:

**Authentication**:
- `Connect { username, password, server_address }` - Authenticate with credentials
- `Register { username, password, full_name, server_address }` - Create new account
- `Disconnect { cid }` - End session

**P2P Operations** (Direct Citadel Protocol):
- `PeerConnect { cid, peer_cid }` - Establish P2P connection
- `PeerRegister { cid, peer_cid, session_security_settings }` - Mutual peer registration
- `PeerDisconnect { cid, peer_cid }` - End P2P connection

**Message Transport**:
- `Message { cid, peer_cid, message_contents }` - Carries subprotocols (WorkspaceProtocol, P2P messages)

**Session Management**:
- `ConnectionManagement { SetConnectionOrphan, ClaimSession, DisconnectOrphan }` - Manage orphan sessions

**Key Data Structures**:
```rust
struct Connection {
    username: String,                          // Stored after Connect
    peers: HashMap<u64, PeerConnection>,       // Active P2P connections
    sink_to_server: PeerChannelSendHalf,       // Channel to server
    client_server_remote: ClientServerRemote,  // Remote control interface
    associated_tcp_connection: Arc<AtomicUuid>,// TCP connection UUID
    c2s_file_transfer_handlers: HashMap<...>,  // File transfer state
    groups: HashMap<...>,                      // Group chat state
}
```

### Layer 2: WorkspaceProtocol (Application Subprotocol)

**Purpose**: Workspace/Office/Room CRUD operations and member management.

**Handled By**: `citadel-workspace-server-kernel`

**Transport**: Inscribed within `InternalServiceRequest::Message { peer_cid: null }` (null means "send to server")

**Message Flow**:
1. Client creates `WorkspaceProtocolPayload::Request(WorkspaceProtocolRequest)`
2. Serializes to JSON bytes
3. Wraps in `InternalServiceRequest::Message { message: bytes, cid, peer_cid: null }`
4. Internal service routes to workspace server via Citadel protocol
5. Workspace server deserializes and processes
6. Server responds with `WorkspaceProtocolPayload::Response` via `Message`

**Operations**:

**Workspace Management**:
- `CreateWorkspace { workspace_name, master_password }` - Create new workspace
- `GetWorkspace { workspace_id }` - Retrieve workspace details
- `UpdateWorkspace { workspace_id, name, master_password }` - Modify workspace
- `DeleteWorkspace { workspace_id, master_password }` - Delete workspace

**Office Management**:
- `CreateOffice { workspace_id, name, description, mdx_content }` - Create office
- `GetOffice { office_id }` - Retrieve office details
- `ListOffices { workspace_id }` - List all offices in workspace
- `UpdateOffice { office_id, name, description, mdx_content }` - Modify office
- `DeleteOffice { office_id }` - Delete office

**Room Management**:
- `CreateRoom { office_id, name, description, mdx_content }` - Create room
- `GetRoom { room_id }` - Retrieve room details
- `ListRooms { office_id }` - List all rooms in office
- `UpdateRoom { room_id, name, description, mdx_content }` - Modify room
- `DeleteRoom { room_id }` - Delete room

**Member Management**:
- `AddMember { workspace_id, username, role }` - Add workspace member
- `GetMember { workspace_id, member_id }` - Get member details
- `ListMembers { workspace_id }` - List all members
- `UpdateMemberRole { workspace_id, member_id, new_role }` - Change member role
- `RemoveMember { workspace_id, member_id }` - Remove member

**P2P Messaging**:
- `Message { sender_cid, recipient_cid, contents }` - P2P chat (inscribed within)

### Layer 3: MessageProtocol (Chat Subprotocol)

**Purpose**: P2P messaging between workspace members.

**Transport**: Triple-nested within:
1. `InternalServiceRequest::Message` (P2P transport to specific peer)
2. `WorkspaceProtocol::Message` (workspace context)
3. `MessageProtocol` (actual chat message)

**Defined In**: `citadel-workspaces/src/types/p2p-types.ts`

**Types**:
- `P2PCommandType.Message` - Text message with metadata
- `P2PCommandType.MessageAck` - Delivery/read receipts
- `P2PCommandType.TypingIndicator` - User typing status

**Message Structure**:
```typescript
interface P2PMessagePayload {
  metadata: {
    message_id: string;
    sender_cid: string;
    recipient_cid: string;
    timestamp: number;
    reply_to?: string;
    mentions?: string[];
    attachments?: any[];
  };
  message_contents: Uint8Array;  // UTF-8 encoded text
  index: number;  // Sequential index for ordering
}
```

## InternalServiceCommand vs WorkspaceProtocol Decision Tree

```
START: Need to perform an operation
  │
  ├─ Is it authentication or session management?
  │  ├─ Connect/Register/Disconnect → InternalServiceRequest (Direct)
  │  └─ Connection management (orphan, claim) → InternalServiceRequest (Direct)
  │
  ├─ Is it P2P connection establishment?
  │  ├─ Open connection → WASM: open_p2p_connection(peer_cid)
  │  ├─ Register with peer → InternalServiceRequest::PeerRegister
  │  └─ Connect to peer → InternalServiceRequest::PeerConnect
  │
  ├─ Is it workspace/office/room/member CRUD?
  │  └─ Wrap in WorkspaceProtocol
  │     └─ Send via InternalServiceRequest::Message { peer_cid: null, message: serialized_protocol }
  │
  └─ Is it P2P messaging?
     └─ Triple-nest:
        1. MessageProtocol (chat content)
        2. WorkspaceProtocol::Message { contents: serialized_message }
        3. InternalServiceRequest::Message { peer_cid: target, message: serialized_workspace }
```

## P2P Messaging Architecture

### Complete Message Path (Triple-Nested Protocol)

```
User A                          Internal Service              User B
  │                                    │                         │
  │ 1. Create MessageProtocol          │                         │
  │    P2PCommand {                    │                         │
  │      type: Message,                │                         │
  │      payload: {                    │                         │
  │        message_contents: "Hello",  │                         │
  │        index: 1                    │                         │
  │      }                             │                         │
  │    }                               │                         │
  │                                     │                         │
  │ 2. Serialize to bytes              │                         │
  │    [72, 101, 108, 108, 111]        │                         │
  │                                     │                         │
  │ 3. Wrap in WorkspaceProtocol       │                         │
  │    Message {                       │                         │
  │      sender_cid: A,                │                         │
  │      recipient_cid: B,             │                         │
  │      contents: [bytes]             │                         │
  │    }                               │                         │
  │                                     │                         │
  │ 4. Serialize WorkspaceProtocol     │                         │
  │    to JSON bytes                   │                         │
  │                                     │                         │
  │ 5. Wrap in InternalServiceRequest  │                         │
  │    Message {                       │                         │
  │      cid: A,                       │                         │
  │      peer_cid: B,                  │                         │
  │      message: [workspace_bytes]    │                         │
  │    }                               │                         │
  │                                     │                         │
  ├────────────────────────────────────>│                         │
  │                                     │                         │
  │                                     │ 6. Route via P2P       │
  │                                     │    (Citadel Protocol)  │
  │                                     │                         │
  │                                     ├────────────────────────>│
  │                                     │                         │
  │                                     │    7. Deserialize       │
  │                                     │       Layer 1: InternalServiceRequest
  │                                     │       Layer 2: WorkspaceProtocol
  │                                     │       Layer 3: MessageProtocol
  │                                     │                         │
  │                                     │    8. Display message   │
  │                                     │       "Hello" from A    │
  │                                     │       index: 1          │
```

### Username Propagation in P2P

**IMPORTANT**: Usernames in P2P registration are **automatically provided by the Citadel SDK**, not from request parameters.

**During Registration**:
1. User A sends `PeerRegister { cid: A, peer_cid: B }` (NO username parameter)
2. Internal service calls Citadel SDK's `propose_target()` and `register_to_peer()`
3. SDK performs mutual registration via Citadel protocol
4. SDK's `PeerSignal::PostRegister` event provides:
   - `inviter_username` - A's username (from SDK's account manager)
   - `invitee_username` - B's username (from SDK's account manager)
5. Internal service passes through to frontend in responses:
   - `PeerRegisterSuccess { peer_username: B_username }`
   - `PeerRegisterNotification { peer_username: A_username }`

**Key Points**:
- Username comes from Citadel SDK's account manager, not from request
- Backend doesn't need to "store" or "propagate" username separately
- Frontend must read `peer_username` field (not `username`)
- No architectural changes needed - it already works correctly

**Common Frontend Bug**:
```typescript
// ❌ WRONG - Reading wrong field name
const username = message.PeerRegisterNotification.username;  // undefined!

// ✅ CORRECT - Read the actual field name
const peerUsername = message.PeerRegisterNotification.peer_username;
```

## Authentication Flow

```
Frontend                  WASM Client             Internal Service      Citadel SDK
   │                           │                        │                    │
   │ 1. Connect/Register       │                        │                    │
   │    { username, password } │                        │                    │
   ├──────────────────────────>│                        │                    │
   │                           │  InternalServiceRequest│                    │
   │                           │  Connect { ... }       │                    │
   │                           ├───────────────────────>│                    │
   │                           │                        │  Authenticate      │
   │                           │                        │  with credentials  │
   │                           │                        ├───────────────────>│
   │                           │                        │                    │
   │                           │                        │<─────SDK───────────┤
   │                           │                        │  Returns:          │
   │                           │                        │  - CID (u64)       │
   │                           │                        │  - Username        │
   │                           │                        │  - AccountManager  │
   │                           │                        │                    │
   │                           │     Store in           │                    │
   │                           │     Connection struct  │                    │
   │                           │     {                  │                    │
   │                           │       cid,             │                    │
   │                           │       username,        │                    │
   │                           │       peers,           │                    │
   │                           │       ...              │                    │
   │                           │     }                  │                    │
   │                           │                        │                    │
   │                           │  ConnectSuccess        │                    │
   │                           │  { cid: 12345 }        │                    │
   │<──────────────────────────┤                        │                    │
   │                           │                        │                    │
   │  Store CID in             │                        │                    │
   │  connectionManager        │                        │                    │
   │  for future requests      │                        │                    │
```

**Session Lifecycle**:
1. **Creation**: After successful `Connect` → stored in `server_connection_map`
2. **Orphan Mode**: Session persists when TCP drops (configurable via `SetConnectionOrphan`)
3. **Claim Session**: New TCP connection can claim orphaned session via `ClaimSession`
4. **Cleanup**: Explicit `Disconnect` or connection drop (if not in orphan mode)

## Session Management

**Storage Maps**:
```rust
// In CitadelWorkspaceService
server_connection_map: HashMap<u64 /* CID */, Connection>
tcp_connection_map: HashMap<Uuid /* TCP UUID */, ResponseSender>
orphan_sessions: HashMap<Uuid /* TCP UUID */, bool /* allow_orphan */>
```

**Orphan Mode Flow**:
```
User closes browser tab
  │
  ├─ TCP connection drops
  │
  ├─ Check: Is orphan mode enabled for this TCP connection?
  │  │
  │  ├─ YES → Keep session in server_connection_map
  │  │         Remove from tcp_connection_map only
  │  │         Session is "orphaned" but still exists
  │  │
  │  └─ NO  → Remove session from server_connection_map
  │            Session is completely terminated
  │
User returns and navigates to /office
  │
  ├─ P2PMessaging component runs connection recovery
  │
  ├─ Call: ClaimSession { session_cid, only_if_orphaned: true }
  │
  ├─ Internal service checks: Is session orphaned?
  │  │
  │  ├─ YES → Associate session with new TCP connection
  │  │         Update tcp_connection_map
  │  │         Return: ConnectionManagementSuccess
  │  │
  │  └─ NO  → Return: ConnectionManagementFailure
  │            "Session is not orphaned"
```

## Multi-Tab Coordination

**Browser-Level WebSocket Management**:

The system uses a **single WebSocket connection per browser**, not per tab or per user. This is a critical architectural decision that affects how sessions, P2P messaging, and multi-user testing work.

**Key Principle**: One browser = One WebSocket = One leader tab

```
Browser Window
  ├─ Tab 1: testuser1 logged in
  ├─ Tab 2: testuser2 logged in
  ├─ Tab 3: testuser1 (different workspace)
  │
  └─ Leader Tab (elected via BroadcastChannel/localStorage)
     └─ Single WebSocket → localhost:12345 (Internal Service)
        └─ Manages ALL sessions across ALL tabs
```

**Leader Election**:
- Implemented in `ConnectionManager.ts`
- Uses `BroadcastChannel` or `localStorage` events for cross-tab coordination
- Leader tab holds the active WebSocket connection
- Follower tabs receive updates via broadcast from leader
- If leader tab closes, a follower automatically promotes to leader

**Message Flow with Multiple Users in Same Browser**:
```
Tab 1 (testuser1) wants to send P2P message
  │
  ├─ Is this tab the leader?
  │  │
  │  ├─ YES → Send directly via WebSocket
  │  │
  │  └─ NO  → Broadcast request to leader tab
  │            Leader receives broadcast
  │            Leader sends via WebSocket
  │
Internal Service receives message
  │
  ├─ Routes P2P message to destination session
  │
Tab 2 (testuser2) receives response
  │
  ├─ Leader tab receives via WebSocket
  │
  └─ Leader broadcasts to all tabs
     │
     └─ Tab 2 receives broadcast and processes message
```

**Testing Multiple Users in Same Browser**:

This architecture enables testing multiple users with a single browser:

1. Open Tab 1 → Create/login testuser1
2. Open Tab 2 → Create/login testuser2
3. **Both tabs share the same WebSocket connection**
4. Internal service manages both sessions via the single connection
5. P2P registration between testuser1 ↔ testuser2 works normally
6. Messages flow: Tab1 → Leader → WebSocket → Internal Service → WebSocket → Leader → Tab2

**Important**: You do NOT need separate browsers or incognito windows for multi-user testing. The single browser with multiple tabs is the designed and supported testing approach.

**Session Storage**:
- `ConnectionManager` stores multiple sessions in browser storage
- Each tab can access different sessions
- Leader coordinates WebSocket communication for all sessions
- When tab switches users, it accesses a different session from storage

## Domain Permissions

**Hierarchical Structure**:
```
Workspace (top-level)
  ├─ Office 1
  │  ├─ Room 1.1
  │  └─ Room 1.2
  └─ Office 2
     └─ Room 2.1
```

**Permission Inheritance**:
- Workspace permissions → Inherited by all offices and rooms
- Office permissions → Inherited by rooms within office
- Room permissions → Scoped to specific room only

**Permission Types**:

**Workspace Level**:
- `CreateOffice` - Create new office
- `DeleteWorkspace` - Delete entire workspace
- `ManageDomains` - Modify domain hierarchy
- `ManageMembers` - Add/remove members

**Office Level**:
- `CreateRoom` - Create new room within office
- `UpdateOffice` - Modify office metadata
- `DeleteOffice` - Delete office
- `ManageOfficeMembers` - Office-specific member management

**Room Level**:
- `EditContent` - Modify MDX content
- `SendMessages` - Send messages in room
- `UploadFiles` - Upload files to room
- `DeleteRoom` - Delete room

**Role-Based Permissions**:
- `Admin` - Full permissions at all levels
- `Owner` - Can manage workspace, create offices/rooms
- `Member` - Can view and participate
- `Guest` - Read-only access
- `Banned` - No access

## Error Handling

### InternalServiceResponse Layer

**Structured Error Types**:
- `ConnectFailure { message, request_id }` - Authentication failed
- `RegisterFailure { message, request_id }` - Registration failed
- `PeerRegisterFailure { message, request_id }` - P2P registration failed
- `MessageSendFailure { message, request_id }` - Message delivery failed

**Error Response Format**:
```rust
InternalServiceResponse::ConnectFailure {
    cid: 0,
    message: "Invalid credentials",
    request_id: Some(uuid)
}
```

### WorkspaceProtocol Layer

**Generic Error Variant**:
```rust
WorkspaceProtocolResponse::Error(String)
```

**Recommendation**: Implement structured errors similar to InternalService:
```rust
// Proposed improvement
enum WorkspaceProtocolError {
    WorkspaceNotFound { workspace_id: String },
    OfficeNotFound { office_id: String },
    PermissionDenied { required_permission: String },
    InvalidInput { field: String, reason: String },
}
```

## Security Architecture

### Encryption

**Session-Level Encryption**:
```rust
struct SessionSecuritySettings {
    security_level: SecurityLevel,     // Standard, High, Ultra
    secrecy_mode: SecrecyMode,        // Perfect, BestEffort
    crypto_params: CryptoParameters,   // Algorithm choices
    header_obfuscator_settings: ...   // Header obfuscation
}

struct CryptoParameters {
    encryption_algorithm: EncryptionAlgorithm,  // AES-GCM-256
    kem_algorithm: KemAlgorithm,               // Kyber (post-quantum)
    sig_algorithm: SigAlgorithm,               // None, Ed25519, etc.
}
```

**P2P Encryption**:
- Configurable per peer connection
- End-to-end encryption for P2P messages
- Post-quantum resistant (Kyber KEM)

### Authentication

**Password-Based**:
```rust
Connect {
    username: String,
    password: SecBuffer,
    server_address: String,
    // Optional:
    server_password: Option<PreSharedKey>,
}
```

**Workspace Master Password**:
- Required for sensitive operations (DeleteWorkspace)
- Separate from user password
- Used for workspace-level authorization

### Authorization

**Permission Checks**:
```rust
// Example: Check if user can create office
fn can_create_office(workspace_id: &str, user_cid: u64) -> Result<(), Error> {
    let workspace = get_workspace(workspace_id)?;
    let member = workspace.members.get(&user_cid)?;

    if member.role == Role::Admin || member.role == Role::Owner {
        Ok(())
    } else if member.permissions.contains(&Permission::CreateOffice) {
        Ok(())
    } else {
        Err(Error::PermissionDenied)
    }
}
```

## Persistence

### Backend Storage (Workspace Server)

**In-Memory with File Persistence**:
```rust
// Periodic saves to disk
async fn save_workspaces(&self) -> Result<(), Error> {
    let json = serde_json::to_string(&self.workspaces)?;
    tokio::fs::write("workspaces.json", json).await?;
    Ok(())
}
```

**Storage Files**:
- `workspaces.json` - All workspace data
- `domains.json` - Office/room hierarchy
- `users.json` - User accounts and roles

**Reload on Startup**:
- Load all JSON files into memory
- Rebuild HashMap indices
- Continue from previous state

### Frontend Storage (LocalDB)

**Via Internal Service**:
```typescript
// Store message cache
const request: InternalServiceRequest = {
  LocalDBSetKV: {
    request_id: crypto.randomUUID(),
    cid: 0,  // 0 = global storage
    peer_cid: null,
    key: "p2p_messages_conversations",
    value: JSON.stringify(conversations)
  }
};
```

**Stored Data**:
- P2P conversation state
- Message cache (last 100 messages per conversation)
- Connection state
- UI preferences

## Development Workflow

### Making Backend Changes

**Critical Workflow**:
```bash
1. Edit Rust code:
   - citadel-internal-service/src/
   - citadel-workspace-server-kernel/src/

2. Run sync-executor agent:
   - Rebuilds WASM clients
   - Regenerates TypeScript bindings
   - Restarts services in order:
     sync-wasm-client → server → internal-service → ui

3. Verify in browser:
   - Check TypeScript types match Rust structs
   - Test functionality
   - Check console for errors
```

**IMPORTANT**: Always run `sync-executor` agent after backend changes and BEFORE UI testing!

### Service Architecture

**Tilt-Based Development**:
```yaml
# docker-compose.yml
services:
  internal-service:
    ports: ["12345:12345"]
    hot_reload: false  # Manual restart required

  server:
    ports: ["12349:12349"]
    hot_reload: false

  ui:
    ports: ["5173:5173"]
    hot_reload: true   # Full HMR support
```

**Restart Order**:
1. `sync-wasm-client` - Rebuild WASM bindings
2. `server` - Restart workspace server kernel
3. `internal-service` - Restart internal service
4. `ui` - Restart UI (if needed)

**Check Service Logs**:
```bash
tilt logs internal-service
tilt logs server
tilt logs ui
```

## Common Patterns

### Pattern 1: Sending Workspace Request

```typescript
import { WorkspaceProtocolPayload } from '@/types';

// Create the workspace protocol request
const payload: WorkspaceProtocolPayload = {
  Request: {
    CreateOffice: {
      workspace_id: "workspace-123",
      name: "Engineering",
      description: "Engineering team office",
      mdx_content: null,
      metadata: null
    }
  }
};

// Serialize to JSON bytes
const messageBytes = new TextEncoder().encode(JSON.stringify(payload));

// Wrap in InternalServiceRequest
await websocketService.sendMessage({
  Message: {
    request_id: crypto.randomUUID(),
    message: Array.from(messageBytes),
    cid: currentUserCid,
    peer_cid: null,  // null = send to workspace server
    security_level: "Standard"
  }
});
```

### Pattern 2: Registering P2P Peer

```typescript
// Register with another peer
await websocketService.sendMessage({
  PeerRegister: {
    request_id: crypto.randomUUID(),
    cid: currentCid,
    peer_cid: targetPeerCid,
    session_security_settings: {
      security_level: "Standard",
      secrecy_mode: "BestEffort",
      crypto_params: {
        encryption_algorithm: "AES_GCM_256",
        kem_algorithm: "Kyber",
        sig_algorithm: "None"
      },
      header_obfuscator_settings: "Disabled"
    },
    connect_after_register: true,
    peer_session_password: null
  }
});

// Listen for response
eventEmitter.on('websocket-message', (message) => {
  if (message.PeerRegisterSuccess) {
    console.log('Registered with peer:', message.PeerRegisterSuccess.peer_username);
    // Note: peer_username is provided by Citadel SDK automatically
  }
});
```

### Pattern 3: Sending P2P Message (Triple-Nested)

```typescript
import { createMessageCommand, serializeP2PCommand } from '@/types/p2p-types';

// 1. Create MessageProtocol (Layer 3)
const messageCommand = createMessageCommand(
  "Hello from User A!",  // text content
  currentUserCid,        // sender
  targetPeerCid,         // recipient
  1                      // message index
);

// 2. Serialize MessageProtocol to bytes
const messageBytes = serializeP2PCommand(messageCommand);

// 3. Wrap in WorkspaceProtocol::Message (Layer 2)
const workspacePayload: WorkspaceProtocolPayload = {
  Request: {
    Message: {
      sender_cid: currentUserCid,
      recipient_cid: targetPeerCid,
      contents: Array.from(messageBytes)
    }
  }
};

// 4. Serialize WorkspaceProtocol to bytes
const workspaceBytes = new TextEncoder().encode(JSON.stringify(workspacePayload));

// 5. Wrap in InternalServiceRequest::Message (Layer 1)
await websocketService.sendMessage({
  Message: {
    request_id: crypto.randomUUID(),
    message: Array.from(workspaceBytes),
    cid: currentUserCid,
    peer_cid: targetPeerCid,  // Send to specific peer
    security_level: "Standard"
  }
});
```

### Pattern 4: Handling P2P Registration Notification

```typescript
// Listen for when another peer registers with us
eventEmitter.on('websocket-message', (message) => {
  if (message.PeerRegisterNotification) {
    const { peer_cid, peer_username } = message.PeerRegisterNotification;

    console.log(`Peer ${peer_username} registered with us (CID: ${peer_cid})`);

    // ✅ CORRECT: Read peer_username field
    // ❌ WRONG: message.PeerRegisterNotification.username (undefined)

    // Update UI to show new peer
    addPeerToList({
      cid: peer_cid.toString(),
      username: peer_username,
      isRegistered: true
    });
  }
});
```

## Testing Strategy

### Playwright Browser Tests

**Multi-User Workflow Tests**:
```typescript
// Test P2P messaging flow
test('P2P messaging between users', async () => {
  // 1. Create two users
  const user1 = await createTestUser('user1_test');
  const user2 = await createTestUser('user2_test');

  // 2. Both navigate to /office
  await user1.page.goto('/office');
  await user2.page.goto('/office');

  // 3. User1 adds user2 as peer
  await user1.addPeerViaSidebar(user2.cid);

  // 4. User2 adds user1 as peer
  await user2.addPeerViaSidebar(user1.cid);

  // 5. User1 sends message
  await user1.sendP2PMessage(user2.cid, 'Hello User2!');

  // 6. User2 receives message
  await expect(user2.getChatMessage()).toContain('Hello User2!');

  // 7. Verify sidebar shows last message
  await expect(user2.getSidebarPreview(user1.cid)).toContain('Hello User2!');
});
```

**Session Management Tests**:
```typescript
test('Orphan session recovery', async () => {
  const user = await createTestUser('user_orphan');
  await user.page.goto('/office');

  // Close browser tab
  await user.page.close();

  // Reopen in new tab
  const newPage = await browser.newPage();
  await newPage.goto('/office');

  // Verify session recovered
  await expect(newPage.locator('.workspace-name')).toContain('User Orphan');

  // Verify workspace data loaded
  await expect(newPage.locator('.offices-section')).toBeVisible();
});
```

### Backend Tests

**Unit Tests**:
```rust
#[tokio::test]
async fn test_peer_registration() {
    let service = CitadelWorkspaceService::new();

    // User A connects
    let cid_a = connect_user(&service, "userA", "password").await;

    // User B connects
    let cid_b = connect_user(&service, "userB", "password").await;

    // A registers with B
    let result = service.handle_peer_register(cid_a, cid_b).await;

    assert!(result.is_ok());
    assert_eq!(result.unwrap().peer_username, "userB");
}
```

## Known Limitations

1. **Single Workspace**: Multi-workspace support not fully implemented (UI shows switcher but backend doesn't persist multiple workspaces per user)

2. **No Message Persistence**: P2P messages stored in frontend LocalDB only, not on backend. Lost on cache clear.

3. **Generic Error Messages**: WorkspaceProtocol uses `Error(String)` instead of structured error types.

4. **No Invitation System**: Members added directly by Admin/Owner, no invite/accept flow.

5. **No Search**: No search functionality across workspaces, offices, rooms, or messages.

6. **Ephemeral Backend**: Backend uses in-memory storage with file persistence, but data cleared on service restart during development (by design for testing).

## Future Enhancements

1. **Structured Error Responses**: Implement `WorkspaceProtocolError` enum with detailed error types

2. **Message Persistence**: Store P2P messages on backend with pagination support

3. **True Multi-Workspace**: Allow users to belong to multiple workspaces with proper data isolation

4. **Member Invitation Flow**: Implement invite → accept/decline → onboarding workflow

5. **Full-Text Search**: Search across all entities (workspaces, offices, rooms, messages, members)

6. **Audit Logging**: Track all operations for security and compliance

7. **Workspace Export/Import**: Allow workspace data portability

8. **Rich Message Types**: Support files, images, code blocks, embeds

9. **Threaded Conversations**: Message threading for organized discussions

10. **Presence System**: Real-time user online/offline status

## Troubleshooting Guide

### Issue: "Session Already Connected"

**Symptoms**: ConnectFailure with "Session Already Connected" error

**Cause**: Trying to connect with same username when session already exists

**Solution**: Use `ClaimSession` instead of `Connect` for orphaned sessions

### Issue: "Unable to find username for local user"

**Symptoms**: PeerRegisterFailure with username error

**Cause**: Frontend reading wrong field name from `PeerRegisterNotification`

**Solution**: Use `peer_username` field, not `username`

**Check**:
```typescript
// ❌ WRONG
const name = message.PeerRegisterNotification.username;

// ✅ CORRECT
const name = message.PeerRegisterNotification.peer_username;
```

### Issue: "WorkspaceLoader timeout redirect"

**Symptoms**: Page redirects to /connect after 5 seconds

**Cause**: WorkspaceLoader expects connection before mounting children

**Solution**: Either:
1. Remove WorkspaceLoader for pages with connection recovery
2. Implement connection recovery before WorkspaceLoader renders

### Issue: "Message deserialization error"

**Symptoms**: "invalid type: string, expected struct"

**Cause**: TypeScript sending wrong data structure to Rust

**Solution**: Check TypeScript bindings match Rust structs exactly:
```typescript
// ❌ WRONG
session_security_settings: {
  crypto_params: "Standard"  // Should be object!
}

// ✅ CORRECT
session_security_settings: {
  security_level: "Standard",
  secrecy_mode: "BestEffort",
  crypto_params: {
    encryption_algorithm: "AES_GCM_256",
    kem_algorithm: "Kyber",
    sig_algorithm: "None"
  }
}
```

## Appendix: File Locations

### Backend (Rust)

**Internal Service**:
- Core service: `citadel-internal-service/src/kernel/mod.rs`
- Request handlers: `citadel-internal-service/src/kernel/requests/`
- Response handlers: `citadel-internal-service/src/kernel/responses/`
- Type definitions: `citadel-internal-service/citadel-internal-service-types/src/lib.rs`

**Workspace Server**:
- Core kernel: `citadel-workspace-server-kernel/src/kernel/mod.rs`
- Protocol handlers: `citadel-workspace-server-kernel/src/handlers/`
- Storage: `citadel-workspace-server-kernel/src/persistence/`
- Types: `citadel-workspace-types/src/lib.rs`

### Frontend (TypeScript)

**Services**:
- WebSocket service: `citadel-workspaces/src/lib/websocket-service.ts`
- Connection manager: `citadel-workspaces/src/lib/connection-manager.ts`
- P2P registration: `citadel-workspaces/src/lib/p2p-registration-service.ts`
- P2P messenger: `citadel-workspaces/src/lib/p2p-messenger-manager.ts`
- Workspace service: `citadel-workspaces/src/lib/workspace-service.ts`

**UI Components**:
- App layout: `citadel-workspaces/src/components/layout/AppLayout.tsx`
- Sidebar: `citadel-workspaces/src/components/layout/sidebar/`
- P2P Chat: `citadel-workspaces/src/components/p2p/P2PChat.tsx`
- Messages section: `citadel-workspaces/src/components/layout/sidebar/MessagesSection.tsx`

### WASM Client

- TypeScript client: `citadel-workspace-client-ts/src/WorkspaceClient.ts`
- WASM bindings: `citadel-internal-service/citadel-internal-service-wasm-client/`

### Configuration

- Docker Compose: `docker-compose.yml`
- Tilt: `Tiltfile`
- TypeScript config: `citadel-workspaces/tsconfig.json`
