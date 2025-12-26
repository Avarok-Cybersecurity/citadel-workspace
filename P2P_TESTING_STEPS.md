# P2P Messaging Testing Steps

## Prerequisites
- Tilt services running (`tilt up`)
- Browser at http://localhost:5173/

## Test Steps

### 1. Create User 1 (Tab 0)
1. Open http://localhost:5173/
2. Click "Join Workspace"
3. Enter username: `p2ptestA_<timestamp>` (e.g., `p2ptestA_1765482949`)
4. Enter password: `test12345`
5. Enter server: `localhost:12349`
6. Click "Connect"
7. Complete workspace initialization if prompted (first user only)

### 2. Create User 2 (Tab 1)
1. Open new browser tab
2. Navigate to http://localhost:5173/
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
