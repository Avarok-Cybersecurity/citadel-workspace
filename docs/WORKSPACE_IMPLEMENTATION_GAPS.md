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
## RESOLVED: why messenger/mod.rs never logged (and what it invalidates)

`messenger/mod.rs:27` is `use citadel_logging as log;`, and citadel_logging wraps
TRACING, not the `log` facade. Every `log::info!` in that file is therefore a
tracing macro needing a subscriber, and the WASM client installs only
`console_log::init_with_level` — a `log`-facade logger. Nothing subscribes to
tracing in the browser, so those records went nowhere.

ILM's lines appear because its Cargo.toml declares BOTH citadel_logging and
`log = "0.4.21"` and it uses the real facade. The connector declared only
citadel_logging. The entire difference is one `use` alias.

**This invalidates everything below that reasons from that silence.** Several
sections conclude the `InternalServiceResponse::MessageNotification` arm "never
executes", "does not run", and that inbound P2P messages therefore take some
undocumented path. That was inferred from missing log output and is NOT
supported: the arm may well run, it simply could not log. The claim was checked
twice — with grep, then again with python after grep proved unreliable — and both
checks were correct about the OUTPUT while wrong about the CONCLUSION drawn from
it. Absence of logging is not absence of execution.

Fixed: the connector now depends on the `log` facade and the four P2P
diagnostics use `::log::info!`. The two pre-existing [P2P-DEBUG] lines bracket
the WASM->JS handoff where payloads go missing, and comparing their counts is
the obvious next measurement — they have existed all along and could never be
read.

Read the sections below with that correction applied.

## Peer folder deletion: not unimplemented, not durable

`file-manager.test.ts` reports `Peer Sees Folder Removed` as a KNOWN GAP and
deliberately leaves it out of the pass criteria, while the sibling check
`peerSeesFileRemoved` IS gated and passes. Files disappear from the peer;
folders do not. That reads like a missing feature. It is not.

Traced end to end, every link exists:

* UI — `useFileManagerHandlers.ts:82` picks `rmdir` for directories;
* hook — `useRevfsTree.ts:80` calls `revfsService.rmdir(myCid, peerCid, path)`;
* service — `revfs-service.ts:115` delegates to `dirOps.peerRmdir`;
* send — `peerRmdir` mutates the tree, persists it, and `sendAndAwaitAck`s the
  operation, structurally identical to `removeFileFromPeer`, which works;
* receive — `tree-sync.ts:53` handles `case RevfsOpType.Rmdir`.

So the deletion is sent and applied. The problem is that it does not STAY
applied.

`mergeTrees` (tree-copy-merge.ts) is a union: it adds remote children that are
missing locally and never removes anything, with an explicit note that
"deletions are handled by explicit RemoveFile/RemoveDir operations, not inferred
from missing children". That is the right call — a tree that lacks a node cannot
be distinguished from a tree that never had it, and inferring deletion from
absence is the heuristic that was correctly removed earlier.

The consequence is that a deletion survives only until the next merge with any
tree that still contains the folder. Applying `Rmdir` removes the node; a
subsequent sync whose payload predates the delete puts it straight back, and
nothing in the tree records that it was ever deleted. Deletion is therefore not
idempotent under merge, and whether it sticks depends on message ordering.

Why files behave better is not that their path is more correct — it is that
`removeFileFromPeer` also issues `backend-delete-file`, so the file's content is
gone from the backing store even if the tree node returns. A resurrected folder
node has nothing to contradict it.

Fixing this is a design decision, not a patch. The usual answer is a tombstone —
record the deletion with a timestamp/version in the tree so a merge can tell
"deleted at T" from "never present", which is what union merge structurally
cannot express today. That changes the on-wire tree format and needs to be
chosen deliberately.

Recorded rather than fixed, and the test's KNOWN GAP label is accurate — but it
should be read as "converges wrongly", not "not built".

## OPEN: test:file-manager is NOT message loss — the op arrives and the view does not follow

Grouped with the delivery failures for most of this session. It does not belong
there. From CI run 32915200004, the full chain on Bob's side:

| step | result |
|---|---|
| Alice creates the folder, sends `Mkdir` | ok |
| Bob RECEIVES it (twice) | ok |
| Bob applies it — `applied Mkdir, updating tree` | ok |
| Bob acks it | ok |
| Bob's UI shows the folder | **no** |

Delivery is fine in both directions: Alice sent 21 ops and Bob received 50; Bob
sent 18 and Alice received 36. `setTree` does call `notifyTreeChanged`, and
`peerPairKey` sorts its inputs, so the key the service writes and the key the
hook watches are identical — that mismatch was checked and ruled out.

The failure counts are byte-identical across two runs (`Folder visible:false` 1,
`File visible:false` 6), which is what makes this look deterministic rather than
like a race.

**Leading hypothesis, NOT confirmed.** `useFileManagerContent` subscribes via
`useRevfsTree(myCid, selectedPeerCid)`, and `selectedPeerCid` is populated by an
effect that reads `registeredPeers[0]`. The peer registry is known to lag 15-20s
behind registration acceptance. If it has not populated when the op lands, the
hook's key is null, nothing is subscribed, and the tree updates for a peer the
UI has not selected. That would explain the deterministic shape.

Confirming needs the revfs/ILM diagnostics, which this spec's console filter was
dropping — its keywords were `['error','Error','revfs','RE-VFS']` with no `ILM`.
Fixed in `7bbd098` across all 22 specs, so the next run carries them.

**Two wrong turns on the way here, recorded so they are not repeated.** First I
called it a functional revfs bug from the identical-counts heuristic alone — a
guess presented as a conclusion. Then I called it a one-directional delivery
failure because a 28-line log window contained no `[Bob] handleRevfsOperation`
lines; the full count refutes that outright. Reading a window and generalising
is the same error behind the retracted "always the middle message" claim.

## RESOLVED: the reconnect message loss, and why every earlier theory missed it

**Root cause (CI run 32912073077, line-level evidence).** The lost message was
emitted to the tab's subscribers TWICE, each time with `listeners=8`, and that
tab's first P2P handler entry appears AFTERWARDS, once the count had climbed to
twelve. Eight services were listening; none of them was the one that handles
chat. `P2PMessengerManager` is a lazy singleton behind a Proxy, so it is not
constructed until something touches chat — and on a reconnecting tab, messages
arrive before that.

The message was never lost by ILM, the transport, or the router. It was
delivered to a room with nobody in it.

**Why `listenerCount` is the wrong guard**, which is the trap this bug is built
from: several unrelated services subscribe to `websocket-message` at module load
— peer registration, workspace responses, group responses, auto-connect. The
count is therefore nonzero exactly when it is least meaningful. Gating on
`listenerCount('websocket-message') > 0` would have read EIGHT here and emitted
into the void. That guard was proposed and rejected before it shipped, on a
fable agent's objection; this run is the proof it would have failed.

**Fixed** in citadel-workspaces:

* `b0e9519` — inbound `MessageNotification`s are held until the P2P handler
  attaches, then replayed in order. Only that type: everything else has
  subscribers attached at module load, so holding it would delay traffic that
  already had a receiver.
* `38ab981` — the messenger is constructed during boot rather than on first
  chat view, which shrinks the window from "whenever the user opens chat" to
  milliseconds. Imported dynamically, so the P2P graph stays off the landing
  critical path (10KB of headroom against a 300KB budget).

**Two mistakes in the fix itself, both caught by an existing test** rather than
by review, which is worth recording:

1. The first version held indefinitely. The self-heal spec asserts the leader's
   fallback DELIVERS rather than strands, and it failed — correctly. An
   unbounded hold trades a rare lost message for a permanently stranded one.
   The hold is now bounded: after 2s it releases to whoever is listening.
2. The release then re-held everything it had just released, because a replay
   re-enters the path that held it. The hazard was described in a comment and
   not actually guarded. Same test caught it.

**Superseded theories.** Each of these was investigated and is NOT the cause;
they are listed so the same ground is not covered again:

| theory | verdict |
|---|---|
| ILM dropping messages | No. 27 delivered, every id 0-14 delivered both directions. |
| Duplicate ACK suppression (`re-ACK`) | No. `Skipping already delivered` = 0 in every failing run; the branch never fires. |
| Stream replacement rescue | No. `ILM-RESCUE` = 0. |
| Teardown destroying the queue | No. `ILM-TEARDOWN` = 0 in the failing run (the probe is still worth keeping). |
| Cross-tab forward loss | No. `forward ->` = 0; no forwards occurred in this test at all. |
| "always the middle message" | No. Retracted; severity varies per run. |

**Still open:** the acked-forward work (`a8f39b2`) addresses a real defect —
forwards had no ack, no retry and no leader-side copy — but it is NOT what fixed
this test, because this test never forwards. It matters for genuine multi-tab
use and is unverified there.

## Partly fixed: one message still lost on reconnect under load

### Run 32892372131: a mechanism that explains the shape, and a fix — with the causal link still unproven

**What the screenshots show** (`screenshots-offline` artifact, which is
available while the run's LOGS are not — worth remembering, it is the faster
route to evidence): Alice sent all three offline messages and her UI shows a
delivery check on **all three**. Bob received message 1 only. So this is not
random loss; it is "first one through, everything behind it stuck", with the
sender believing it succeeded.

**The mechanism, from the code.** ILM's outbound path is stop-and-wait per peer
and `break`s on the first message it cannot send (`process_outbound`,
lib.rs:551). A message stays at the head of that queue until its ACK arrives —
`can_send` requires `msg_id > last_sent`, which the message's own id fails the
moment it is sent — so one unacknowledged message blocks every message behind
it.

That makes the receiver's duplicate handling load-bearing, and it was wrong:
`process_inbound` recognised an already-delivered message, cleared it, and
`continue`d **without sending an ACK**. Retransmission is the only recovery this
protocol has, and that branch made it useless: the sender retransmits, the
receiver drops it silently, forever. `MAX_CONSECUTIVE_BLOCKS` recovery does not
help — it clears the tracker and resends message 1, straight back into the same
branch. Messages 2 and 3 are never sent at all, which is why they appear nowhere
in the logs on Bob's side.

**Fixed** in intersession-layer-messaging `26e1038`: a duplicate is now
re-ACKed. De-duplication is unchanged; the application still sees the message
once. The test asserts both halves — not delivered twice, and acknowledged
twice — and fails on the second against the previous code.

**What is NOT established.** The fix is protocol-correct on its own terms, but
the causal link to this failure is unproven. Running `test:offline` locally
twice against a rebuilt WASM carrying the fix passed all three messages — and
the fixed path never executed:

```
Re-ACKing duplicate          occurrences: 0
Skipping already delivered   occurrences: 0
```

So those passes are NOT evidence for the fix; the test simply passes locally and
fails in CI. The first link — Bob's original ACK going missing — remains
inferred, not observed. Confirming it needs the `[ILM-ACK-RECV]` lines from a
CI run.

**The finding worth more than the passes.** From that same *passing* local run:

```
ILM-BLOCKED                  69
ILM-BLOCKED-RECOVERY          6
ILM-ACK-RECV                 60
[ILM-SEND] SUCCESS           36
```

Head-of-line blocking is not an edge case here: 69 blocks in a run that
succeeded, and the emergency path that wipes `last_sent`/`last_acked` fired 6
times. That path exists because ACKs go missing often enough to need it. The
sender routinely stalls and routinely resorts to discarding its tracking state
to move again. CI just has the timing that turns a stall into a permanent one.
Stop-and-wait with a single outstanding message, no retransmission timer, and a
break-on-first-blocked loop is the underlying fragility; re-ACKing removes the
permanent failure but not the stalling.


### Run 32866171470: the shortfall is at the WASM->JS handoff, and it is not "the middle message"

**Correction first.** Two earlier runs each lost exactly "offline message 2", and
I wrote that the loss was structurally the MIDDLE of the three, reasoning that a
race would not pick the middle twice running. This run lost messages 2 AND 3.
Three samples, not two, and the pattern does not hold: severity varies per run.
That inference was over-fitted to a sample of two and should not be relied on.

**What this run establishes, by count:**

* ILM delivered SIX messages to Bob's reconnected session (msg_id 7-12).
* The client logged SEVEN raw receipts carrying only FOUR distinct content
  fingerprints — every payload arrived twice except one, which arrived once.
* Of those four, only two were conversation texts ("offline message 1" and the
  welcome); the other two are ack-sized (124B, 119B).
* The test lost two texts, matching the shortfall exactly.

So ILM hands over six messages and the client's raw-receipt log accounts for
four distinct payloads. The gap is between ILM's `deliver()` and the client's
first sight of the bytes — the WASM->JS handoff — not in decode, not in routing,
and not in the conversation store, all of which log everything they are given.

**Why the join is still half-built.** The client fingerprint works (47 `fp=`
lines). The matching ILM-side `[ILM-DELIVER]` line did NOT appear even once,
despite `Compiling citadel-internal-service-connector` in the same job's build
and `LocalDeliveryTx` being the delivery type ILM is instantiated with
(`messenger/mod.rs:197`, wired at :302). The code is in the binary and its
branch is on the only path messages can take, yet it is silent — the same
silence that makes every other `messenger/mod.rs` log invisible. Whatever
explains that explains where the two payloads go, and it is now the single
highest-value thing to find.

Note the one asymmetry worth carrying forward: duplicate delivery is the NORM
here (every payload logged twice), and the messages that go missing are near
payloads that arrived only once. Whether the duplicate is a retry that usually
covers a lossy first hop is untested and would explain the variability.

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

### SUPERSEDED: "it is always the middle message"

**This heading was wrong and is kept only so the reasoning below can be read in
context.** It was written from two samples; run 32866171470 lost messages 2 AND
3, and run 32892372131 lost 2 and 3 as well. Severity varies per run and the
"middle" framing does not hold. The index evidence below is still accurate as a
record of that one run — it is the generalisation that failed.

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
SUPERSEDED — see the RESOLVED section at the top of this document. The
instruction not to instrument that arm was based on the mistaken belief that it
never runs; the arm's logs were simply going to tracing with no subscriber.

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
