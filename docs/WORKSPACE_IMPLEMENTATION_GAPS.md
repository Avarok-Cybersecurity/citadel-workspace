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
## Partly fixed: one message still lost on reconnect under load

### Verdict on the receiver-drop fix (CI run 32857173644): it did NOT fix this

The `restore_message_stream` fix — which stopped a replaced `UnboundedReceiver`
from being dropped with its queue — is a real defect fix and is kept, but the
loss is unchanged. Exactly the same message is missing: "Bob, this is offline
message 2". Do not treat that fix as the resolution.

Caveat on how firmly this rules it out: the rescue path logs through
`console_log!`, and macro output is not captured in these runs at all (the
`WASM client initialized successfully` line is absent too, and that cannot not
have fired). So the fix's own log proves nothing either way; what is established
is only that the OUTCOME is unchanged.

### The sharpest fact so far: it is always the middle message

Messages carry an app-level `index`. On Bob's reconnected session the handler
received index 6 (offline 1), 8 (offline 3), 9 (welcome), 10 — with **index 7
absent**. The prior run showed the same shape one lower: 5 and 7 present, 6
missing. Both times the lost message is the MIDDLE of the three sent while the
peer was offline.

Arrival order is stranger still, and consistent across both runs: offline 3
arrives FIRST (`had=0`), then offline 1 (`had=1`), and offline 2 never. Last,
then first, never the middle. A race would not pick the middle element twice
running; this looks structural — a slot being overwritten or skipped rather than
a message being dropped in flight.

### What is eliminated, by counts, in this run

* ILM delivered to Bob-Reconnect **gapless**: msg_ids 11,12,13,14,15,16.
* The client received 8 raw P2P messages and handled all 8 — 4
  `MessagingLayerCommand` and 4 `MessageAck`, with no exit path logging a drop.
* Those 4 commands carried offline 1, offline 3, welcome and Bob's own echo.
  Offline 2 is in none of them.

So ILM hands over a complete sequence and the client decodes everything it is
given, yet one text is missing from the result.

### The join that is still missing

ILM logs `msg_id` with no content; the client logs content and app `index` with
no `msg_id`. Nothing connects them, so "which ILM delivery carried index 7, and
what did it decode to" remains unanswerable. Note the three offline messages are
the same length, so length cannot be used as the key either.

The next instrumentation should therefore log a content fingerprint alongside
`msg_id` at ILM's `deliver()`, and the same fingerprint at the client's raw
receipt. Not in `messenger/mod.rs`'s MessageNotification arm — verified twice,
with grep and again with python, that nothing in that file logs during these
runs.

## Superseded notes: messages still lost on reconnect under load

**Narrowed 2026-08-25 from CI run 32849810636.** One message is now lost, not
two of three — the peer-write-lock fix accounts for the difference. What the
diagnostics establish, with the counts they rest on:

* **The send side is clean.** Alice's ILM outbound queue went 0 -> 1 -> 2 -> 3
  as each offline message was written, so all three were enqueued; all three
  were sent, each with `[ILM-SEND] SUCCESS` and a matching ACK.
* **ILM did not drop it.** Delivery across both Bob sessions is gapless:
  msg_id 1-8 to the original session, 9-14 to the reconnected one.
* **No client exit path fired.** On Bob-Reconnect: 9 raw messages received, 9
  reaching `handleP2PCommand` (5 `MessagingLayerCommand` + 4 `MessageAck`), and
  ZERO hits for "Message for different session", "Unexpected message format",
  "Failed to deserialize", or either payload type-check failure. The session
  filter — long suspected — dropped nothing at all.
* **No stale-tab interference.** The original Bob tab's last log line precedes
  the reconnected tab's first, so the two never overlapped and no leader/follower
  handoff could have swallowed it.

Those five `MessagingLayerCommand`s carried only three distinct texts (offline 3,
offline 1, welcome — the duplicates are broadcast echoes, correctly de-duped).
"Bob, this is offline message 2" appears in NO browser context anywhere in the
run. So it is lost between ILM's delivery inside WASM and the client's decode.

**Why it cannot be closed from this log.** ILM logs `msg_id` with no content;
the client logs content with no `msg_id`. Neither side can be joined to the
other, so which ILM delivery carried the lost text is unanswerable from what is
currently emitted. Payload length does not discriminate either — the three
offline messages differ only in one digit and are the same length.

**The blocked next step.** `citadel-internal-service-connector/src/messenger/mod.rs`
already brackets exactly the handoff in question, logging `[P2P-DEBUG]
MessageNotification arrived` and `[P2P-DEBUG] FORWARDED ISM MessageNotification
to JS` with lengths. Comparing those two counts would settle it immediately —
but **neither appears anywhere in the run**. They log to `target: "citadel"`,
which the WASM log filter drops, while `target: "ism"` comes through at info.
**Correction, verified after writing the above: the log filter is not the cause.**
The WASM client calls `console_log::init_with_level(log::Level::Info)` with no
target filtering, so `target: "citadel"` is not being dropped. The binary is not
stale either — `strings` on the shipped
`citadel-workspaces/public/wasm/*_bg.wasm` finds both `P2P-DEBUG` sites and the
`ILM-INBOUND` site compiled in, matching the source exactly.

The real finding is sharper: across the entire run, the ONLY Rust file that logs
is `intersession-layer-messaging/src/lib.rs` (2600 lines).
`citadel-internal-service-connector/src/messenger/mod.rs` logs **zero** lines,
though its code is linked and ILM — which it wraps — is plainly running.

So the `InternalServiceResponse::MessageNotification` arm at messenger/mod.rs:379
is never reached. Inbound P2P messages do not flow through the path
ARCHITECTURE/CLAUDE.md describes (`messenger/mod.rs:341` receiving
MessageNotification and forwarding to JS). Whatever consumes them does so
earlier, and that undocumented path is where the lost message has to be chased.
Do not spend time adding instrumentation to messenger/mod.rs's
MessageNotification arm.

(Caveat on that inference: the harness's console capture is demonstrably lossy —
the WASM client's `console_log!` MACRO output is absent entirely, including
"WASM client initialized successfully", which cannot not have fired. The
`log`-crate channel does work, since ILM's 2600 lines arrive through it, so the
messenger conclusion rests on a channel known to function. Treat it as strong,
not certain.)

### The concrete mechanism, found by reading rather than logging

`citadel-internal-service-wasm-client/src/lib.rs` — `next_message()` TAKES the
delivery stream out of the shared state, awaits exactly one message, then calls
`restore_message_stream()` to put it back. That helper discards the receiver on
two paths:

```rust
let Some(state) = guard.as_mut() else { return; };   // torn down -> receiver dropped
if state.stream.is_none() { state.stream.replace(stream); }
                                                     // else    -> receiver dropped
```

An `UnboundedReceiver` dropped this way takes **every message still queued in it**
with it. The `else` branch is not hypothetical — the comment above it names the
case: `restart` installing a fresh state with its own stream while we awaited.
That is precisely the reconnect this test performs.

This fits every observation that survived the eliminations: ILM logs `Delivered`
because it successfully sent into `final_tx` (`LocalDeliveryTx::deliver`), so
delivery genuinely succeeded from ILM's side; and the client never sees the
message because the receiving half was thrown away before JS drained it. It also
explains why no client-side exit path fired — the message never reached JS to be
dropped by one.

Note the window is wide open by construction: between `take()` and restore, the
stream lives on the stack of a single in-flight call, so anything that replaces
state during that await loses whatever arrived in the meantime.

**Proposed fix:** never drop a receiver that may hold messages. On replacement,
drain the old receiver and hand its contents to the surviving stream (a pending
queue in `WorkspaceState` that `next_message` checks before awaiting), rather
than letting it fall out of scope. Same for the torn-down path, where the
messages should at least be logged rather than vanishing silently.

Note also that `if (!isMessage(layer)) return;` in `message-handler-routing.ts`
is unreachable: `handleIncomingMessage` is only called from the
`case MessagingLayerType.Message` branch, so the guard can never be false. It is
not a candidate drop site despite looking like one.

## Superseded notes: messages still lost on reconnect under load

**One real cause was found and fixed. It is not the only one.**

`appendMessageToPage` was a read-modify-write against IndexedDB — load metadata,
load the page, mutate, save — with four awaits between read and write and no
serialisation. Two messages appended concurrently both read the same page, each
pushed onto their own copy, and the second save overwrote the first. Appends and
the three other per-peer mutators (`updateMessageInPages`,
`updatePeerUsernameInMetadata`, `updateUnreadCount`) now run one at a time
through `peer-write-lock`.

That fix is genuine: `test:offline` passed three consecutive local runs (9 of 9
messages) having failed every run before, and `test:reconnect-both-c2s` went
14/15 to 15/15.

**But CI still fails**, on a slower and more contended runner, losing TWO of the
three offline messages rather than one. So at least one more loss path exists.

What the CI failure rules out, checked the same way as before:

- ILM delivered every message; there is no gap in the delivered ids. (An
  apparent gap at id 8 was a grep artefact — the peer id is truncated in the
  log — not a missing delivery.)
- No `Message for different session` skips, no deserialisation failures, and the
  `no peer_cid` skips number exactly 21 in every context, which is the server's
  own C2S traffic being correctly ignored.
- Not pagination: `MESSAGES_PER_PAGE` is 50 and no page rollover occurred for
  roughly thirteen messages.
- The conversation de-duplication matched six times, all genuine UUID repeats
  from ILM retransmission.

Session routing is ruled out too, and that one looked promising. Cumulative
counts suggested the pre-disconnect context was still handling messages after
the reconnect; splitting them at the reconnect line shows otherwise — the old
context dispatches ZERO after that point, and the reconnected one dispatches
seven. Beware the cumulative reading: it invited exactly the wrong conclusion.

So the messages reach `handleP2PCommand` on the right instance, and two of them
never reach the conversation the UI renders. Everything above that boundary is
now eliminated by evidence; the remaining span is `handleP2PCommand` →
`addMessageToConversation` → the rendered list.

The logs cannot narrow it further: the handler records byte counts, not
contents, so there is no way to tell which of the seven dispatches carried which
message. The next step is temporary instrumentation logging the decoded text at
`addMessageToConversation` and at the point the list renders, run against this
spec under CI-like load until it reproduces.
