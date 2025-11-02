# P2P Messaging Test Agent

Test and verify end-to-end P2P messaging functionality between multiple users.

## Objective

Verify complete P2P messaging workflow including:
- Peer registration (bidirectional)
- P2P connection establishment
- Message sending/receiving
- Message ordering
- Sidebar display (Slack-like)
- Read receipts and typing indicators

## Test Phases

### Phase 1: Setup & Account Creation
1. Create 2 test accounts:
   - user1_p2p_{timestamp}
   - user2_p2p_{timestamp}
   - Password: `test12345` for both
2. Navigate both to http://localhost:5173/p2p
3. Take screenshot: `01_p2p_page_loaded.png`

### Phase 2: Peer Discovery
1. Check console logs for "P2P Registration Service started"
2. Wait 2 seconds for peer discovery
3. User1: Check available peers list for user2
4. User2: Check available peers list for user1
5. Take screenshot: `02_available_peers.png`

### Phase 3: Peer Registration (User1 → User2)
1. User1: Get user2 CID from active sessions
2. User1: Click "Add Peer" or enter user2 CID
3. Wait for `PeerRegisterSuccess` in backend logs
4. Verify user2 appears in user1's peer list
5. Take screenshot: `03_user1_registered_user2.png`

### Phase 4: Peer Registration (User2 → User1)
1. User2: Get user1 CID from active sessions
2. User2: Add user1 as peer
3. Wait for bidirectional registration
4. Verify both peers show as registered
5. Take screenshot: `04_bidirectional_registration.png`

### Phase 5: First Message (User1 → User2)
1. User1: Click on user2 in peer list
2. User1: Type message: "Hello User2! Testing P2P messaging."
3. User1: Send message
4. Wait 2 seconds for delivery
5. Check user1 console for message status updates
6. Take screenshot: `05_user1_sent_message.png`

### Phase 6: Receive Message (User2)
1. User2: Check if message appears in chat
2. Verify message content matches
3. Verify sender shown correctly
4. Check unread badge on user1 conversation
5. Take screenshot: `06_user2_received_message.png`

### Phase 7: Reply Message (User2 → User1)
1. User2: Type reply: "Hi User1! Received your message successfully."
2. User2: Send message
3. Wait 2 seconds
4. Take screenshot: `07_user2_sent_reply.png`

### Phase 8: Bidirectional Messaging
1. User1: Send 3 messages (sequential)
2. User2: Send 3 messages (sequential, interleaved)
3. Verify all 6 messages appear in correct order on both sides
4. Check message indices are sequential
5. Take screenshot: `08_bidirectional_messages_user1.png`
6. Take screenshot: `09_bidirectional_messages_user2.png`

### Phase 9: Sidebar Verification
1. User1: Check P2PPeerList sidebar shows:
   - User2's avatar/initials
   - Green dot (online status)
   - Last message preview
   - Unread count (if applicable)
2. User2: Same checks for user1
3. Take screenshot: `10_sidebar_display.png`

### Phase 10: Backend Verification
1. Check `tilt logs internal-service` for:
   - `PeerRegister` requests (2x)
   - `PeerRegisterSuccess` responses (2x)
   - `PeerMessage` events
2. Check `tilt logs server` for P2P protocol messages
3. Verify no errors in logs

## Success Criteria

**All phases must pass:**
- ✅ Both users created and logged in
- ✅ Peer discovery works (sees available peers)
- ✅ Bidirectional registration succeeds
- ✅ Messages sent/received in both directions
- ✅ Message order preserved (sorted by index)
- ✅ Peers appear in sidebar with correct info
- ✅ No backend errors

## Implementation

Use Playwright MCP to:
1. Create accounts (reuse create-account agent pattern)
2. Navigate to /p2p page
3. Interact with P2P UI (add peer, send message)
4. Verify UI state (peer list, messages, sidebar)
5. Check browser console logs
6. Take screenshots at each phase

## Error Handling

If any phase fails:
1. Log exact error message
2. Take screenshot of failure state
3. Check browser console for errors
4. Check backend logs for protocol errors
5. Report which phase failed and why
6. Suggest fix if obvious (e.g., missing UI element, protocol error)

## Output Format

Report results as:

```
# P2P Messaging Test Report
Date: {timestamp}
Result: PASS/FAIL

## Phase Results
Phase 1: ✅ PASS - Both accounts created
Phase 2: ✅ PASS - Peer discovery working
...

## Issues Found
- [List any issues]

## Screenshots
- [List screenshot paths]

## Backend Logs
- [Relevant log excerpts]
```
