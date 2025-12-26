# Future Optimizations

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
