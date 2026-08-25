# Testing Guide

Consolidated from the former `TESTING_QUICK_START.md`, `P2P_TESTING.md` and `P2P_TESTING_STEPS.md`.

---

## Quick start

Everything below assumes the stack is up (`docker compose up -d --wait`, or Tilt)
and the UI is on **http://localhost:5291**.

```bash
cd citadel-workspaces

npm run typecheck        # strict tsc, no emit
npm run lint             # eslint, zero warnings tolerated
npm test                 # unit + component tests (vitest, jsdom)
npm run build            # production build
npm run check:bundle     # landing critical path must stay under budget
npm run check:pwa        # the app must remain installable
```

`check:bundle` and `check:pwa` exist because both properties fail silently. A
chunk pulled onto the first paint just makes the app slower, and a broken
manifest field just means the browser stops offering to install it — nothing
errors in either case, so only an explicit check notices.

### Browser tests

Two suites, for historical reasons, both real:

```bash
cd citadel-workspaces/integration-tests

npx playwright test                       # accessibility, responsive, keyboard,
                                          # login, P2P, multi-tab, office CRUD
npm run build && node dist/tests/<name>.test.js   # the legacy runner
```

The Playwright suite includes gates that are easy to lose and hard to notice
losing:

| Spec | What it defends |
|---|---|
| `accessibility.spec.ts` | axe over nine screens; fails on serious/critical only |
| `responsive.spec.ts` | no horizontal overflow at 375px, and controls stay reachable |
| `keyboard-navigation.spec.ts` | every flow usable without a mouse; dialogs escapable |

The legacy runner covers the protocol-heavy scenarios — P2P messaging, file
transfer, the workspace tree, reconnection. `.github/workflows/validate.yml`
lists the full set it runs.

### Two things that will waste your time if you do not know them

**The suite shares one backend.** Every spec registers real accounts against the
same server, so specs cannot run concurrently — `playwright.config.ts` pins
`workers: 1` for this reason, and running two suites at once produces failures
that look exactly like product bugs. Each spec resets the backend before it runs
(`restartBackend` on `TestHarness.create`, which is required rather than
defaulted, so a new spec cannot forget). **Re-run a failure alone before
diagnosing it** — that habit predates the reset and is still the cheapest way to
separate a real defect from an environment one.

**Do not edit `citadel-workspaces/src` while specs are running.** Vite serves the
working tree with hot reloading, so a mid-run edit swaps the component under test
and you get a failure that will not reproduce, or a pass that was never earned.
Editing files under `integration-tests/` is safe — the runner builds `dist/` once
before the first spec.

To run a few specs and keep partial results, use the batch runner:

```bash
cd citadel-workspaces/integration-tests
./scripts/run-specs.sh p2p-messaging file-manager group-chat/office-chat
```

It prints one line per spec and writes the full output to `/tmp/spec-<name>.log`.
A verdict of **NO VERDICT** means the process died before reporting — a crash
rather than a failed assertion, so read the tail of the log. An uncaught
rejection inside a spec takes node down and discards every result it had already
collected.

**`locator.isVisible({ timeout })` does not wait.** The timeout is ignored and it
answers about the current instant. Use `isVisibleWithin(locator, ms)` /
`isHiddenWithin(...)` from `src/lib` for a presence or absence assertion, and
plain `isVisible()` with no argument when you genuinely mean "right now". This
one API is where most of this suite's sleeps came from, and where several
assertions that appeared to pass were never checking anything.

---

## Session management (specific scenario)

### TL;DR

```bash
# 1. Verify fixes are in code
./verify-session-fixes.sh

# 2. Run guided manual test
./test-session-management.sh

# 3. Review results
cat ./logs/session-test-*.log | tail -50
```

---

## What's Being Tested

The "Session Already Connected" bug fix that:
- Cleans up old sessions before re-login
- Prevents duplicate session errors
- Enables smooth logout → login cycles

---

## Files Created

| File | Purpose | When to Use |
|------|---------|-------------|
| `verify-session-fixes.sh` | Checks code for fixes | Before testing, CI/CD |
| `test-session-management.sh` | Guided UI testing | Manual testing |
| `SESSION_MANAGEMENT_TEST_RESULTS.md` | Full documentation | Reference, troubleshooting |
| `./logs/session-test-*.log` | Test output logs | After test runs |

---

## Quick Test (5 minutes)

### Step 1: Verify Code
```bash
./verify-session-fixes.sh
```
**Expected**: All 5 checks pass ✅

### Step 2: Run UI Test
```bash
./test-session-management.sh
```

Follow the prompts:
1. Create account at http://localhost:5291/
2. Logout via avatar dropdown
3. Login again with same credentials

### Step 3: Check Results
The script will tell you:
- ✅ Pass: No session errors
- ⚠️ Warning: Needed retries
- ❌ Fail: Session errors occurred

---

## What Success Looks Like

### In Logs (`tilt logs internal-service`)
```
Checking for existing sessions for user: testuser123
Found 1 existing session(s) for user testuser123, cleaning up: [12345]
ConnectSuccess { cid: 67890 }
```

### In UI
- Create account → enters workspace immediately
- Logout → redirected to index page
- Login → **enters workspace immediately** (no loading spinner stuck)

---

## What Failure Looks Like

### In Logs
```
Session Already Connected
Retry attempt 1/3 for Session Already Connected error
Retry attempt 2/3 for Session Already Connected error
```

### In UI
- Stuck on loading screen
- Multiple connection attempts
- Error messages

---

## Troubleshooting

### Script won't run
```bash
chmod +x verify-session-fixes.sh test-session-management.sh
```

### Services not running
```bash
tilt get uiresources
# Should show: ui, server, internal-service
```

### Can't access UI
```bash
# Check if UI is on port 5291
lsof -i :5291

# If not, check Tiltfile for port config
```

### The whole app is broken and the internal service logs nothing

Check `citadel-workspaces/public/wasm/` is not empty. An empty directory makes
the browser fetch `index.html` for the `.wasm` URL — the console shows
`expected magic word 00 61 73 6d, found 3c 21 44 4f` (that is `<!DO`) — WASM init
throws, and **every internal-service call silently does nothing**. It presents as
a dozen unrelated failures at once (login, workspace init, directory navigation)
while the service logs only health checks.

Recover with `./sync-wasm-clients.sh`, or `cargo check -p citadel-workspace-internal-service`
from the repo root, which rebuilds and redistributes the client.

### Playwright cannot launch a browser

If the error names an impossible browser build (`chromium-1234`) and tells you to
run `npx playwright install`, installing browsers will not help. Two Playwright
copies are resolving differently: `npx` finds the root's, `require()` walks up
from `integration-tests` and finds another. Remove the shadow:

```bash
rm -rf citadel-workspaces/node_modules/{playwright,playwright-core,@playwright}
```

### vitest or the build complains about a platform binary

The Docker sync installs Linux binaries into the bind-mounted
`citadel-workspaces/node_modules` on a macOS host. Restore the tree with `npm ci`
from the REPO ROOT — not a targeted delete, which leaves a version-mixed tree
that fails in more confusing ways.

### Code changes not taking effect in a container

`docker compose restart` reuses what is in the image. Rust services AND
`sync-wasm-clients.sh` (which is copied into the sync image, not mounted) need:

```bash
docker compose build internal-service server sync-wasm-client
docker compose up -d
```

### Audio/video call specs

`call-audio-video.spec.ts` and `call-group.spec.ts` launch their own browsers
with `--use-fake-device-for-media-stream`, so they need no camera, microphone or
permission prompt. They do need peers connected with a UDP path; a call that
cannot get one reports that explicitly rather than hanging.

### Need more detailed logs
```bash
# Follow internal-service logs in real-time
tilt logs internal-service -f

# In another terminal, run your test
```

---

## After Testing

### If Successful ✅
- Document results in commit message
- Update bug tracker: RESOLVED
- Consider automated UI tests (Playwright)

### If Failed ❌
1. Save logs: `tilt logs internal-service > failed-test.log`
2. Check which fix component failed
3. Review SESSION_MANAGEMENT_TEST_RESULTS.md
4. Report findings with logs

### If Needed Retries ⚠️
- Fix is working (fallback logic)
- But pre-connect cleanup could be improved
- Consider increasing 50ms delay or investigating timing

---

## For CI/CD

Add to pipeline:
```yaml
- name: Verify Session Management Fixes
  run: ./verify-session-fixes.sh
```

---

## Questions?

Read the full documentation:
```bash
cat SESSION_MANAGEMENT_TEST_RESULTS.md
```

Or check the code:
- Pre-connect cleanup: `citadel-internal-service/citadel-internal-service/src/kernel/requests/connect.rs:37-55`
- Disconnect cleanup: `citadel-internal-service/citadel-internal-service/src/kernel/requests/disconnect.rs:24`
- Request docs: `citadel-internal-service/REQUESTS.md`

---

## P2P testing


## Overview

This guide documents how to test peer-to-peer (P2P) messaging functionality in the Citadel Workspace system, with special attention to the **multi-tab, single-WebSocket architecture**.

---

## Critical Architecture Understanding

### One Browser = One WebSocket

**IMPORTANT**: The system uses **ONE WebSocket connection per browser**, NOT per tab or per user.

```
Browser Window
  ├─ Tab 1: testuser1 logged in
  ├─ Tab 2: testuser2 logged in
  ├─ Tab 3: testuser3 logged in
  │
  └─ Leader Tab (elected automatically)
     └─ Single WebSocket → localhost:12345 (Internal Service)
        └─ Manages ALL sessions across ALL tabs
```

**Key Points**:
- Leader tab elected via BroadcastChannel/localStorage
- Follower tabs receive updates via broadcast from leader
- All user sessions in the browser share the single WebSocket
- Internal service manages multiple sessions via the same connection

**For Detailed Architecture**: See [ARCHITECTURE.md § Multi-Tab Coordination](./ARCHITECTURE.md#multi-tab-coordination)

---

## Testing Approach

### ✅ Correct: Single Browser, Multiple Tabs

```bash
# Open Tab 1
http://localhost:5291/ → Create testuser1

# Open Tab 2 (same browser)
http://localhost:5291/ → Create testuser2

# Test P2P between Tab 1 and Tab 2
# Both users share the same WebSocket connection
```

### ❌ Wrong: Multiple Browsers or Incognito

```bash
# DON'T DO THIS for local testing
Browser 1 → testuser1
Browser 2 (or incognito) → testuser2
```

**Why?** The multi-tab coordination is designed to work within a single browser. Using multiple browsers introduces unnecessary complexity and doesn't test the actual production architecture.

---

## P2P Testing Workflow

### Phase 1: Create Test Users

#### Tab 1: Create First User
1. Navigate to `http://localhost:5291/`
2. Fill in workspace connection:
   - Workspace: `127.0.0.1:12349`
   - Password: (leave empty)
3. Accept default security settings
4. Create user profile:
   - Full Name: `Test User One`
   - Username: `testuser1` (or timestamp-based)
   - Password: `test12345`
5. **First user only**: Initialize workspace with master password
6. Verify: Redirected to `/office` route

#### Tab 2: Create Second User
1. Open new tab (same browser)
2. Navigate to `http://localhost:5291/`
3. Repeat connection steps (same workspace)
4. Create user profile:
   - Full Name: `Test User Two`
   - Username: `testuser2`
   - Password: `test12345`
5. **Skip initialization**: Workspace already initialized
6. Verify: Redirected to `/office` route

**Expected State**:
- Both tabs logged in as different users
- Both sessions active in internal service
- Single WebSocket managing both sessions
- Leader tab elected (check browser DevTools → Application → BroadcastChannel)

---

### Phase 2: Peer Discovery

#### In Tab 1 (testuser1):
1. Navigate to `/office` if not already there
2. Look at left sidebar → "Direct Messages" section
3. Click the search/add peer button
4. Note: testuser2 should appear in available peers list

#### In Tab 2 (testuser2):
1. Navigate to `/office`
2. Check left sidebar → "Direct Messages"
3. Click search/add peer
4. Note: testuser1 should appear in available peers list

**Expected Behavior**:
- `ListAllPeers` request shows both users to each other
- Both users appear with real usernames (not "User 36414494...")
- Online status indicators show "online"

**Check Logs**:
```bash
tilt logs internal-service | grep -i "ListAllPeers"
```

**Expected Log Output**:
```
ListAllPeersResponse { cid: ..., peer_information: { ... } }
```

---

### Phase 3: Peer Registration

#### In Tab 1 (testuser1):
1. From available peers list, click on `testuser2`
2. Click "Add Peer" or similar action
3. Wait for registration to complete

**Expected Backend Flow**:
```
Tab 1 → Leader Tab → WebSocket → Internal Service
  │
  ├─ PeerRegister { peer_cid: testuser2_cid }
  │
Internal Service → Citadel Protocol
  │
  ├─ Mutual peer registration via Citadel SDK
  │
Internal Service → WebSocket → Leader Tab
  │
  ├─ PeerRegisterSuccess { peer_username: "testuser2" }
  │
  └─ PeerRegisterNotification { peer_username: "testuser1" } (to testuser2)
```

**Check Logs**:
```bash
tilt logs internal-service | grep -i "PeerRegister"
```

**Expected Log Output**:
```
PeerRegister request received
PeerRegisterSuccess { peer_username: "testuser2", ... }
PeerRegisterNotification { peer_username: "testuser1", ... }
```

**UI Verification**:
- Tab 1: testuser2 appears in "Direct Messages" list with real username
- Tab 2: testuser1 appears in "Direct Messages" list with real username
- Both show online status indicators

---

### Phase 4: P2P Connection

#### In Tab 1:
1. Click on testuser2 in "Direct Messages" sidebar
2. URL should change to include P2P parameters (e.g., `?showP2P=true&p2pUser=testuser2`)
3. P2PChat component should load

**Expected Backend Flow**:
```
Tab 1 → Leader → WebSocket → Internal Service
  │
  ├─ PeerConnect { peer_cid: testuser2_cid }
  │
Internal Service → Opens P2P channel via Citadel
  │
  └─ PeerConnectSuccess
```

**Check Logs**:
```bash
tilt logs internal-service | grep -i "PeerConnect"
```

**UI Verification**:
- Chat interface loads
- Shows peer username in header
- Message input field active
- No error messages

---

### Phase 5: P2P Messaging

#### Send Message from Tab 1 to Tab 2:
1. In Tab 1 (testuser1), type message: `Hello from testuser1`
2. Press Enter or click Send
3. Switch to Tab 2 (testuser2)
4. Verify message appears in chat

**Message Flow (Triple-Nested Protocol)**:
```
Layer 1: InternalServiceRequest::Message
  └─ peer_cid: testuser2_cid
  └─ message_contents: [serialized Layer 2]

Layer 2: WorkspaceProtocol::Message
  └─ contents: [serialized Layer 3]

Layer 3: MessageProtocol::Chat
  └─ content: "Hello from testuser1"
  └─ timestamp: ...
```

**Message Path Through System**:
```
Tab 1 (testuser1) types message
  │
  ├─ Is Tab 1 the leader?
  │  │
  │  ├─ YES → Send directly via WebSocket
  │  └─ NO  → Broadcast to leader, leader sends via WebSocket
  │
WebSocket → Internal Service (localhost:12345)
  │
  ├─ Routes to testuser2 session (same internal service instance!)
  │
Internal Service → WebSocket → Leader Tab
  │
Leader Tab → Broadcasts to all tabs
  │
Tab 2 (testuser2) receives broadcast
  │
  └─ P2PChat component displays message
```

#### Send Message from Tab 2 to Tab 1:
1. In Tab 2 (testuser2), click on testuser1 in sidebar
2. Type message: `Hello from testuser2`
3. Press Enter
4. Switch to Tab 1
5. Verify message appears

**Verify**:
- Messages appear in correct order
- Timestamps are accurate
- Sender names display correctly
- No duplicate messages
- Unread counts update in sidebar

---

### Phase 6: Multi-Message Testing

#### Rapid Message Exchange:
1. Send 5 messages from Tab 1
2. Send 5 messages from Tab 2
3. Verify all 10 messages appear in both tabs
4. Verify messages are in chronological order
5. Check sidebar shows last message preview

**Check Logs for Errors**:
```bash
# Should see NO errors or warnings
tilt logs internal-service | grep -i "error\|warn\|fail"
tilt logs server | grep -i "error\|warn\|fail"
```

---

## Verification Checklist

### TypeScript Bindings ✅
- [ ] `PeerRegisterNotification` uses `peer_username` field (not `username`)
- [ ] `ListAllPeersResponse` accesses `peer_information` field (not `online_peers`)
- [ ] `ListRegisteredPeersResponse` accesses `peers` field (not `online_peers`)
- [ ] `PeerInformation` uses `name` field (not `full_name`)

### Peer Discovery ✅
- [ ] Both users see each other in available peers list
- [ ] Usernames display correctly (not "User 36414494...")
- [ ] Online status indicators work
- [ ] Search/filter functionality works

### Peer Registration ✅
- [ ] PeerRegister succeeds without "Unable to find username" error
- [ ] Both users receive PeerRegisterNotification
- [ ] Registered peers appear in "Direct Messages" sidebar
- [ ] Registration persists across tab refresh

### P2P Connection ✅
- [ ] PeerConnect succeeds
- [ ] Chat interface loads without errors
- [ ] Peer username displays in chat header
- [ ] Connection status indicators work

### P2P Messaging ✅
- [ ] Messages send bidirectionally
- [ ] Messages appear in correct order
- [ ] Timestamps are accurate
- [ ] No duplicate messages
- [ ] Unread counts update correctly
- [ ] Last message preview shows in sidebar
- [ ] Messages persist across tab refresh (if stored)

### Multi-Tab Coordination ✅
- [ ] Leader election completes successfully
- [ ] Follower tabs receive message broadcasts
- [ ] Messages sent from follower tabs work (via leader)
- [ ] Leader tab closure promotes a follower to leader
- [ ] All tabs stay synchronized

---

## Troubleshooting

### Issue: "Unable to find username for local user"

**Symptom**: PeerRegister fails with username error

**Cause**: TypeScript reading wrong field name (`username` instead of `peer_username`)

**Fix**: Verify `p2p-registration-service.ts` line 149 reads:
```typescript
peerUsername: message.PeerRegisterNotification.peer_username
```

**Verify Fix**:
```bash
grep -n "peer_username" citadel-workspaces/src/lib/p2p-registration-service.ts
```

---

### Issue: Users show as "User 36414494..."

**Symptom**: Peer list shows CID instead of username

**Cause**: Backend returns `name` field, frontend expects `full_name`

**Fix**: Verify `updatePeerMaps()` in `p2p-registration-service.ts` line 358:
```typescript
fullName: peer.name || peer.username || 'Unknown User'
```

---

### Issue: ListAllPeers returns empty

**Symptom**: No peers show up in discovery

**Cause**: Response parsing reads wrong field (`online_peers` vs `peer_information`)

**Fix**: Verify `listAllPeers()` line 263:
```typescript
const peerInfo = response.peer_information || {};
return Object.values(peerInfo);
```

---

### Issue: Messages don't appear in Tab 2

**Symptom**: Send from Tab 1, nothing shows in Tab 2

**Possible Causes**:
1. Leader election failed
2. BroadcastChannel not working
3. P2P routing issue in internal service

**Debug Steps**:
```bash
# Check leader election
# Open DevTools → Console in both tabs
# Look for "Leader elected" or similar logs

# Check internal service logs
tilt logs internal-service | grep -i "message\|p2p"

# Verify both sessions active
tilt logs internal-service | grep "server_connection_map"
```

---

### Issue: WebSocket Connection Fails

**Symptom**: "WebSocket connection to ws://localhost:12345 failed"

**Cause**: Internal service not running

**Fix**:
```bash
# Check internal service status
tilt get uiresources | grep internal-service

# Restart if needed
tilt trigger internal-service

# Check logs
tilt logs internal-service
```

---

## Expected Log Patterns

### Successful P2P Flow

**Peer Discovery**:
```
ListAllPeers { request_id: "...", cid: 12345 }
ListAllPeersResponse { peer_information: { "67890": PeerInformation { ... } } }
```

**Peer Registration**:
```
PeerRegister { cid: 12345, peer_cid: 67890 }
PeerRegisterSuccess { peer_cid: 67890, peer_username: "testuser2" }
PeerRegisterNotification { peer_cid: 12345, peer_username: "testuser1" }
```

**P2P Connection**:
```
PeerConnect { cid: 12345, peer_cid: 67890 }
PeerConnectSuccess { peer_cid: 67890 }
```

**P2P Messaging**:
```
InternalServiceRequest::Message { peer_cid: 67890, message_contents: [...] }
(Message routed to peer session)
```

---

## Performance Testing

### Stress Test: Rapid Messages
1. Send 100 messages rapidly from Tab 1
2. Verify all appear in Tab 2 in order
3. Check for memory leaks (DevTools → Memory)
4. Verify no WebSocket backpressure

### Stress Test: Multiple Peers
1. Create 5 users in 5 tabs (same browser)
2. Register all users with each other
3. Send messages between various pairs
4. Verify message routing works correctly
5. Check internal service CPU/memory usage

---

## Integration with Testing Scripts

### Automated P2P Test (Future)
Consider creating `test-p2p-messaging.sh` similar to `test-session-management.sh`:

```bash
#!/bin/bash
# P2P Messaging Test Script

echo "=== P2P Messaging Test ==="
echo "1. Open Tab 1 and create testuser1"
read -p "Press Enter when testuser1 is logged in..."

echo "2. Open Tab 2 and create testuser2"
read -p "Press Enter when testuser2 is logged in..."

echo "3. Register peers in both tabs"
read -p "Press Enter when peer registration complete..."

echo "4. Send test message from Tab 1"
read -p "Did message appear in Tab 2? (y/n) " msg_received

if [ "$msg_received" = "y" ]; then
  echo "✅ P2P messaging working!"
else
  echo "❌ P2P messaging failed - check logs"
  tilt logs internal-service | tail -50
fi
```

---

## Related Documentation

- **Architecture**: [ARCHITECTURE.md § Multi-Tab Coordination](./ARCHITECTURE.md#multi-tab-coordination)
- **Development Guide**: [CLAUDE.md § Multi-Tab Testing](./CLAUDE.md#multi-tab-testing-single-browser)
- **Protocol Layers**: [ARCHITECTURE.md § Protocol Layers](./ARCHITECTURE.md#protocol-layers)
- **Session Management**: [SESSION_MANAGEMENT_TEST_RESULTS.md](./SESSION_MANAGEMENT_TEST_RESULTS.md)

---

## Success Criteria

**P2P messaging is working correctly when**:

✅ Peer discovery shows all users with real usernames
✅ Peer registration succeeds without errors
✅ P2P connections establish successfully
✅ Messages send bidirectionally between tabs
✅ Messages appear in chronological order
✅ Sidebar updates with last message previews
✅ Unread counts increment correctly
✅ Multi-tab coordination works (leader election, broadcasts)
✅ No "Session Already Connected" errors
✅ No username propagation errors
✅ No TypeScript binding errors in browser console

---

**Test Guide Version**: 1.0
**Date**: October 31, 2025
**Last Updated**: After TypeScript binding fixes for P2P registration

---

## P2P manual test steps


## Prerequisites
- Tilt services running (`tilt up`)
- Browser at http://localhost:5291/

## Test Steps

### 1. Create User 1 (Tab 0)
1. Open http://localhost:5291/
2. Click "Join Workspace"
3. Enter username: `p2ptestA_<timestamp>` (e.g., `p2ptestA_1765482949`)
4. Enter password: `test12345`
5. Enter server: `localhost:12349`
6. Click "Connect"
7. Complete workspace initialization if prompted (first user only)

### 2. Create User 2 (Tab 1)
1. Open new browser tab
2. Navigate to http://localhost:5291/
3. Click "Join Workspace"
4. Enter username: `p2ptestB_<timestamp>` (same timestamp as user1)
5. Enter password: `test12345`
6. Enter server: `localhost:12349`
7. Click "Connect"

### 3. Initiate P2P Registration
1. In Tab 0 (user1), look for "Discover Peers" button in sidebar (under WORKSPACE MEMBERS)
2. Click "Discover Peers"
3. **Verify**: ListAllPeers returns without timeout (should complete within 5 seconds)
4. Verify modal shows 2 peers found
5. Find user2 in the list
6. Click "Connect" button next to user2

### 4. Accept P2P Registration
1. Switch to Tab 1 (user2)
2. If needed, navigate to Landing page
3. Look in "Active Workspaces" section
4. Click on user2's workspace card
5. **Look for**: "1 pending connection request" badge (red badge near workspace header)
6. Click the badge to open "Pending Connection Requests" dialog
7. Find user1's request in the list
8. Click "Accept" button

### 5. Verify P2P Connection Established
1. **Toast appears**: "Connection Accepted - You are now connected with p2ptestA_<timestamp>"
2. Look in sidebar under "WORKSPACE MEMBERS"
3. **Verify**: user1 now appears as a connected peer

### 6. Test Bidirectional Messaging
**Send from user2 to user1:**
1. In Tab 1 (user2), click on user1 in WORKSPACE MEMBERS
2. Chat panel opens on the right
3. Type: "Hello from user2!" in the message input
4. Press Enter or click Send
5. **Verify**: Message appears in chat with timestamp

**Receive at user1:**
1. Switch to Tab 0 (user1)
2. **Verify**: Tab title shows notification badge (e.g., "(4)")
3. Look in DIRECT MESSAGES section (sidebar)
4. Click on user2 to open chat
5. **Verify**: Message "Hello from user2!" is displayed

**Reply from user1 to user2:**
1. Type: "Hello back from user1!"
2. Press Enter
3. **Verify**: Message appears with checkmark (delivery ACK)

**Confirm at user2:**
1. Switch to Tab 1 (user2)
2. **Verify**: Reply message is displayed in chat

## Expected Results

| Step | Expected Result |
|------|----------------|
| ListAllPeers | Response within 5s (no timeout errors in console) |
| ListRegisteredPeers | Response within 5s (may be empty if no prior P2P) |
| P2P Registration Request | Toast: "Request sent...", Button changes to "Awaiting Response..." |
| Accept Registration | Toast: "Connection Accepted...", peer appears in WORKSPACE MEMBERS |
| Send Message | Message appears immediately with timestamp |
| Receive Message | Tab title shows (N), message appears in chat |
| Delivery ACK | Checkmark icon appears on sent messages |

## Console Logs to Check

**Successful P2P registration:**
```
[LOG] PeerRegisterNotification received
[LOG] PeerRegistrationStore: Added pending request
```

**Successful messaging:**
```
[LOG] [P2P] Sending message to peer
[LOG] [P2P] Message received from peer
[LOG] MessageAck received: {"type":"MessageAck","payload":{"ack_type":"delivered"...}}
```

## Troubleshooting

### ListAllPeers/ListRegisteredPeers Timeout
- Check `tilt logs internal-service` for errors
- Backend fix applied: 5-second timeout wrapper in `list_registered.rs`

### P2P Registration Not Appearing
- Verify both users are on same server (`localhost:12349`)
- Check console for `PeerRegisterNotification` messages

### Messages Not Delivering
- Verify P2P connection is established (peer shows in WORKSPACE MEMBERS)
- Check console for WebSocket connection status

### Call specs sit on "Still waiting for channel ready... (attempt N/60)"

Expected, not a hang. The line reads `connected but not yet ready (no message
received)`, and that wording is exact: a P2P channel counts as ready only once a
message has actually arrived over it, because ILM's two directions warm up
independently — A→B can work while B→A does not, and a channel that reports
"connected" can still drop the first thing you send.

The specs therefore exchange a verified message in both directions per pair
before doing anything that matters. Reaching attempt 40 of 60 is normal on a
cold stack; a three-peer group call warms three pairs, so budget for it.

Exhausting all 60 is usually still the flake, not a defect. Observed: one
direction warms instantly while the other never does — the log shows only
`B -> A` retrying, never `A -> B` — and the same spec passed 8/8 on an immediate
re-run with no retries at all. Before investigating, re-run the spec ALONE. Two
consecutive failures, or retries in both directions, are what make it worth
looking at the code.

Read the direction before concluding anything. A failure here is in warm-up,
which uses ordinary chat messages, so it implicates P2P messaging rather than
whatever feature the spec was about to test.

Do not "fix" this by lowering the retry count. The wait exists because the
alternative is a call that fails later, somewhere less obvious.
