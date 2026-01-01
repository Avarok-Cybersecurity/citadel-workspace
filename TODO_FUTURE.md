# Future Optimizations

## Quick notes that need to be formally processed and added to this very document

### Quick note 1: Account settings expansion

"Please add an account settings modal (or, there may already be one that opens when clicking the user avatar on the top right then clicking a settings/options or similar option) that allows users to upload an avatar and other relevant settings you
  can infer should exist for this app. Please make the avatar drag-and-drop compatible so it can easily be changed. To ensure data optimization, please resize the input avatar to a dimension that is as large as the largest render area for the
  avatar/user=profile-pic, and, convert to webp. Then, ensure that this information can be shared and stored via the central server's workspace-level protocol commands. Since this is binary data, you can send it all in one message (the protocol
  handles chunking)". You can perhaps treat this as a special case of a file upload where the data is sent to the central server and stored for all to see, and use the same protocol for sending the avatar data. We need a test to ensure this works; the browser-based transfer mode should work just fine.

### Quick note 2: Default office config key

Within the definition of an office, there should be an optional "default" key that itself defaults to false. Only 1 default may be chosen. If more than 1 default office, validation error. It there is 0 defaults, then the "default" becomes the first office in the list. Note that the notion of a "default office" just means that that's the first office navigated to when the user logs in.

### Quick note 3: Use the real markdown, ensure editing markdown per office and room works and persists

We need to use the real markdown that the server reads from the config files when rendering the markdown. We have defaults stored in a neat hierarchy, and should be using that, not stubs. And, of course since users may edit the content, when they update the content via the WorkspaceCommand-level protocol that the server reads, we need to ensure that the changes are persisted appropriately such that, even when the server resarts, if the markdown content was updated and thus different that whatever was read on reinitialization, we use the updated content. This needs to be robust, as companies will depend on synchronization of markdown content between users. If we don't already have it, whenever markdown is edited, the server can broadcast the updated content to all connected clients. Users that are offline will get the contents the typical way.

### Quick note 4: offline messaging

We need a test that ensures that when a user is offline, that if another tries sending messages, that A) the receiver receives both messages, and B) the sender receives a notification that the message was received successfully. The test should register both users, each send a message, THEN have one disconnect (not just leave, but truly disconnect), and then the online user sends multiple messages including a live doc message, then, after the offline user reconnects, both send a message to each other, and interact in the live doc, and assert along the away that everything was received. You can also add-in a file transfer send request while offline too.

### Quick note 5: allow, for each office and room, enable a "theme" key
We must determine all the values below that we CURRENTLY use. Then, during the parsing stage, if certain values are missing,
we inject defaults, thus allowing users to override specific parts while using the rest.
{
    "theme": {
        "sidebar-icon": {
            "type": "lucide", # or material,
            "icon": "home",
        },
        "background": "#ffffff",
        "text": "#000000",
        "primary": "#007bff",
        "secondary": "#6c757d",
        "success": "#28a745",
        "danger": "#dc3545",
        "warning": "#ffc107",
        "info": "#17a2b8",
        "light": "#f8f9fa",
        "dark": "#343a40"
    }
}

  

#### Implementation Status (December 2024)

**Status: IMPLEMENTED - Using ILM with wasmtimer**

Test infrastructure has been implemented at `integration-tests/src/tests/offline-messaging.test.ts` with helpers:
- `disconnectViaTcpDrop()` - Simulates TCP drop to orphan session
- `assertSessionInOrphanNavbar()` - Verifies session appears in OrphanSessionsNavbar
- `reconnectViaClaimSession()` - Reclaims orphaned session

**ILM (Intersession Layer Messaging) Architecture**

The Rust ILM system (`intersession-layer-messaging/src/lib.rs`) provides reliable messaging with:
- `process_outbound()` runs every 200ms checking connected peers
- `poll_peers()` runs every 5s detecting reconnected peers
- Message queuing for offline peers with automatic retry on reconnection
- Guaranteed delivery with ACKs

**WASM Compatibility**

ILM uses platform-agnostic timing via conditional compilation:
```rust
#[cfg(not(target_arch = "wasm32"))]
async fn platform_sleep(duration: Duration) {
    tokio::time::sleep(duration).await;
}

#[cfg(target_arch = "wasm32")]
async fn platform_sleep(duration: Duration) {
    wasmtimer::tokio::sleep(duration).await;
}
```

**Frontend Integration**

P2P messages now route through ILM via `sendP2PMessageReliable()` (`p2p-messenger-manager.ts`):
```typescript
// Use ILM for reliable P2P messaging with offline queuing
await websocketService.sendP2PMessageReliable(currentCid, peerCid, serialized);
```

**Files**
- `intersession-layer-messaging/src/lib.rs` - Core ILM with wasmtimer support
- `citadel-internal-service-wasm-client/src/lib.rs` - WASM bindings with sendP2PMessageReliable
- `citadel-workspaces/src/lib/p2p-messenger-manager.ts` - Frontend using ILM

## Vite Build Optimizations

### Issue 1: Dynamic Import Conflicts

The following modules are both dynamically and statically imported, which prevents proper code-splitting:

#### connection-manager.ts
- **Dynamically imported by:**
  - `server-auto-connect-service.ts`
  - `websocket-service.ts` (2x)
- **Statically imported by:**
  - `AccountManagementDialog.tsx`
  - `Join.tsx`
  - `Login.tsx`
  - `OrphanSessionsNavbar.tsx`
  - `WorkspaceApp.tsx`
  - `WorkspaceEventHandler.tsx`
  - `MembersSection.tsx`
  - `TopBar.tsx`
  - `WorkspaceSwitcher.tsx`
  - `PeerDiscoveryModal.tsx`
  - `workspace-loader.tsx`
  - `WorkspaceView.tsx`
  - `p2p-auto-connect-service.ts`
  - `p2p-messenger-manager.ts`
  - `p2p-registration-service.ts`
  - `peer-registration-store.ts`
  - `user-service.ts`
  - `websocket-service.ts`
  - `Landing.tsx`

**Fix:** Either use consistent static imports everywhere, or refactor to use dynamic imports throughout to enable proper code-splitting.

#### user-service.ts
- **Dynamically imported by:**
  - `WorkspaceInitializationModal.tsx`
- **Statically imported by:**
  - `WorkspaceApp.tsx`
  - `WorkspaceEventHandler.tsx`

**Fix:** Change `WorkspaceInitializationModal.tsx` to use static import, or refactor other components to use dynamic imports.

### Issue 2: Large Chunk Size

The main bundle (`index-*.js`) exceeds 500 kB after minification (approximately 1,970 kB).

**Recommended Solutions:**
1. Use `dynamic import()` to code-split the application
2. Configure `build.rollupOptions.output.manualChunks` to improve chunking
3. Adjust `build.chunkSizeWarningLimit` in vite.config.ts (temporary workaround)

**Suggested Manual Chunks Configuration:**
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', ...],
          wasm: ['citadel-internal-service-wasm-client'],
        }
      }
    }
  }
});
```

---

## MDX Content Features

### Dynamic Linking for Navigation

Implement dynamic linking within MDX content files to enable easy navigation between offices and rooms.

**Use Cases:**
- Link from Welcome office to specific rooms: `[Getting Started](/office/tutorials/getting-started)`
- Link between offices: `[Visit Tutorials](/office/tutorials)`
- Link to specific rooms within current office: `[General Chat](./general)`
- Deep links with anchors: `[API Section](/office/tutorials/advanced-features#api)`

**Implementation Ideas:**
1. Create custom MDX components for internal links
2. Use React Router's `<Link>` component with office/room path resolution
3. Add link validation to warn about broken internal links
4. Support relative and absolute paths within workspace hierarchy

**Example MDX Usage:**
```mdx
# Welcome to Citadel Workspaces

Check out our [Getting Started Guide](/office/tutorials/getting-started) to learn the basics.

## Quick Links
- [General Discussion](/office/welcome/general)
- [Advanced Features](/office/tutorials/advanced-features)
- [Announcements](/office/welcome/announcements)
```

---

## Checklist

- [ ] Fix `connection-manager.ts` dynamic/static import conflict
- [ ] Fix `user-service.ts` dynamic/static import conflict
- [ ] Configure manual chunks for vendor libraries
- [ ] Configure manual chunks for UI components
- [ ] Configure manual chunks for WASM client
- [ ] Verify bundle size is under 500 kB after optimizations
- [ ] Add lazy loading for route-based code splitting
- [ ] Consider tree-shaking improvements for unused code
