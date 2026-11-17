# UX Issues Fix Plan

## Issues Identified

### Issue 1: Stale Peers in DIRECT MESSAGES Sidebar
**Severity:** Medium
**Description:** Multiple "Peer XXXXXX" entries from previous test runs appear in the DIRECT MESSAGES sidebar, cluttering the UI.

**Root Cause:**
- `P2PMessengerManager.cache.conversations` is persisted to LocalDB
- On page load, old conversations are loaded from cache
- `syncPeerConnectionsFromSession()` validates against server for registration, but doesn't clean up stale conversations
- `MembersSection.tsx` displays ALL conversations from `P2PMessengerManager.getAllConversations()` without filtering

**Fix:**
1. Add `cleanupStaleConversations(validPeerCids: string[])` method to `P2PMessengerManager`
2. Call this cleanup in `MembersSection.tsx` after loading registered peers from server
3. Only show conversations for peers that are currently registered

### Issue 2: No Visible Timestamps on Messages
**Severity:** Minor
**Description:** Test reports `"timestamps": false` even though `BubbleFooter.tsx` renders timestamps.

**Root Cause:**
- Timestamps ARE rendered in `BubbleFooter.tsx:33-38` with `opacity-70`
- The test likely checks for a specific pattern/class that isn't matched
- Need to verify test assertion logic

**Fix:**
1. Verify timestamp visibility in the DOM (may be a test issue, not a real bug)
2. If needed, add a `data-testid="message-timestamp"` for reliable test selection

### Issue 3: Mixed Status Indicators on Stale Peers
**Severity:** Low
**Description:** Stale peers show yellow/red status dots, creating visual noise.

**Root Cause:**
- Status comes from `p2pAutoConnectService.isPeerConnected()` and `isPeerOnline()`
- Stale peers have incorrect status because they're not in the server's registry
- Same root cause as Issue 1 - stale data

**Fix:**
- Once Issue 1 is fixed (cleaning up stale conversations), this issue is automatically resolved
- Stale peers won't appear in the UI, so their status dots won't be visible

## Implementation Steps

### Step 1: Add cleanup method to P2PMessengerManager
File: `src/lib/p2p-messenger-manager.ts`

```typescript
/**
 * Remove conversations for peers that are no longer registered.
 * Call this after syncing with server to clean up stale cached data.
 */
public cleanupStaleConversations(validPeerCids: Set<string>): void {
  const staleCids: string[] = [];

  for (const [peerCid, conversation] of this.cache.conversations.entries()) {
    if (!validPeerCids.has(peerCid)) {
      staleCids.push(peerCid);
    }
  }

  for (const cid of staleCids) {
    console.log(`[P2P] Removing stale conversation for peer: ${cid.slice(0, 8)}...`);
    this.cache.conversations.delete(cid);
  }

  if (staleCids.length > 0) {
    this.persistConversations();
    eventEmitter.emit('p2p:conversations-cleaned');
  }
}
```

### Step 2: Update MembersSection to clean up stale conversations
File: `src/components/layout/sidebar/MembersSection.tsx`

In the `loadRegisteredPeers` function (around line 127), after getting server-validated peers:

```typescript
// After getting validated peers from server
const validPeerCids = new Set(peerList.map(p => p.cid));

// Clean up stale conversations that reference non-registered peers
const messenger = P2PMessengerManager.getInstance();
messenger.cleanupStaleConversations(validPeerCids);
```

### Step 3: Add data-testid for timestamp (optional, for tests)
File: `src/components/p2p/bubbles/BubbleFooter.tsx`

```tsx
<span className="text-xs opacity-70" data-testid="message-timestamp">
```

## Testing Assertions

After implementing fixes, verify:

1. **Stale peers cleaned up:**
   - [ ] Create user1, user2
   - [ ] Exchange messages
   - [ ] Disconnect/reload
   - [ ] Create new users (user3, user4)
   - [ ] Verify DIRECT MESSAGES shows only current session peers

2. **Timestamps visible:**
   - [ ] Send a message
   - [ ] Verify timestamp appears in HH:MM format
   - [ ] Check both sent and received messages

3. **Status indicators correct:**
   - [ ] Only current registered peers appear
   - [ ] Connected peers show green dot
   - [ ] Online (registered but not connected) show yellow
   - [ ] No stale peers with confusing status

## Files to Modify

1. `src/lib/p2p-messenger-manager.ts` - Add `cleanupStaleConversations()` method
2. `src/components/layout/sidebar/MembersSection.tsx` - Call cleanup after server sync
3. `src/components/p2p/bubbles/BubbleFooter.tsx` - Optional: add data-testid

## Risk Assessment

- **Low Risk:** Changes are additive (new cleanup method) and surgical (small integration points)
- **No Breaking Changes:** Existing functionality preserved; only stale data is removed
- **Reversible:** If issues arise, can disable cleanup by removing the call
