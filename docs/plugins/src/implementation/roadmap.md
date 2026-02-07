# Implementation Roadmap

## Phase 1: Foundation (Core Infrastructure)

**Goal**: Establish plugin system foundation without breaking existing functionality.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: FOUNDATION                                                         │
│  Duration: Core infrastructure                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1.1 Plugin Manifest & Registry                                              │
│      □ Define PluginManifest struct (Rust + TypeScript)                     │
│      □ Create plugin registry storage in workspace metadata                  │
│      □ Add WorkspaceProtocolRequest variants for plugin management          │
│        - InstallPlugin, UninstallPlugin, ListPlugins, GetPluginStatus       │
│                                                                             │
│  1.2 Capability System                                                       │
│      □ Define PluginCapability enum with all levels                         │
│      □ Implement capability validation pipeline                              │
│      □ Add workspace policy settings for capability allowlists              │
│                                                                             │
│  1.3 Plugin Handle (Level 0-1 only)                                          │
│      □ Implement basic PluginHandle interface                                │
│      □ UIHandle: registerComponent, onEvent, getState                       │
│      □ DataHandle: read-only workspace/office/room access                   │
│      □ SignalHandle: subscribe only                                          │
│                                                                             │
│  1.4 Frontend Plugin Host                                                    │
│      □ Create PluginHost class with iframe sandboxing                       │
│      □ Implement message passing between host and plugins                   │
│      □ Integrate with MDX component registry                                 │
│                                                                             │
│  Deliverables:                                                               │
│      ✓ Plugins can be installed/uninstalled via admin UI                    │
│      ✓ Plugins can register custom MDX components                           │
│      ✓ Plugins can read workspace data (read-only)                          │
│      ✓ Plugins can subscribe to signals                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase 2: Interactivity (Level 1-2 Capabilities)

**Goal**: Enable plugins to modify workspace state and interact with users.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: INTERACTIVITY                                                      │
│  Depends on: Phase 1                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  2.1 UI Manipulation                                                         │
│      □ UIHandle: registerPanel (sidebar, bottom, modal, floating)           │
│      □ UIHandle: inject (DOM manipulation with selector constraints)        │
│      □ Theme extension support                                               │
│                                                                             │
│  2.2 MDX Editing                                                             │
│      □ MDXHandle: setContent, patchContent                                  │
│      □ MDXHandle: createEditSession (collaborative editing)                 │
│      □ MDX transformer pipeline                                              │
│                                                                             │
│  2.3 Signal Emission                                                         │
│      □ SignalHandle: emit (local domain)                                    │
│      □ Signal validation and rate limiting                                   │
│      □ Signal audit logging                                                  │
│                                                                             │
│  2.4 Messaging                                                               │
│      □ MessagesHandle: send P2P messages as plugin                          │
│      □ Message attribution (from: plugin-id)                                 │
│                                                                             │
│  Deliverables:                                                               │
│      ✓ Plugins can add custom panels to UI                                  │
│      ✓ Plugins can modify MDX content                                       │
│      ✓ Plugins can emit signals within their domain                         │
│      ✓ Plugins can send messages on behalf of users                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase 3: Signal Propagation (Hierarchical Events)

**Goal**: Implement the hierarchical signal propagation system.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: SIGNAL PROPAGATION                                                 │
│  Depends on: Phase 2                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  3.1 Signal Router                                                           │
│      □ Implement SignalRouter with domain hierarchy awareness               │
│      □ Upward propagation (escalation)                                       │
│      □ Downward propagation (delegation)                                     │
│      □ Sibling propagation (coordination)                                    │
│                                                                             │
│  3.2 Signal Queuing                                                          │
│      □ Per-domain signal queues                                              │
│      □ Admin review interface                                                │
│      □ Signal acknowledgment system                                          │
│                                                                             │
│  3.3 Signal Transforms                                                       │
│      □ Transform functions during propagation                                │
│      □ Filter functions (stop/skip conditions)                               │
│                                                                             │
│  3.4 Broadcast (Level 4)                                                     │
│      □ Workspace-wide broadcast capability                                   │
│      □ Rate limiting and admin approval                                      │
│                                                                             │
│  Deliverables:                                                               │
│      ✓ Signals propagate up/down domain hierarchy                           │
│      ✓ Admins can review queued signals                                     │
│      ✓ Incident escalation pattern works end-to-end                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase 4: Backend Plugins (WASM Runtime)

**Goal**: Enable server-side plugin execution in sandboxed WASM.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: BACKEND PLUGINS                                                    │
│  Depends on: Phase 3                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  4.1 WASM Runtime                                                            │
│      □ Integrate wasmtime for plugin execution                              │
│      □ Capability-filtered host function linking                            │
│      □ Resource limiting (fuel, memory)                                      │
│                                                                             │
│  4.2 Plugin Hooks                                                            │
│      □ Before/after request hooks                                            │
│      □ Member lifecycle hooks                                                │
│      □ Signal handling hooks                                                 │
│                                                                             │
│  4.3 Plugin SDK                                                              │
│      □ Rust SDK for building backend plugins                                │
│      □ Plugin development guide                                              │
│      □ Example plugins                                                       │
│                                                                             │
│  Deliverables:                                                               │
│      ✓ Backend plugins run in sandboxed WASM                                │
│      ✓ Plugins can hook into workspace operations                           │
│      ✓ Plugin SDK available for developers                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase 5: System Capabilities (Level 4)

**Goal**: Enable powerful system integrations with strict security controls.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: SYSTEM CAPABILITIES                                                │
│  Depends on: Phase 4                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  5.1 Filesystem Access                                                       │
│      □ FileSystemHandle implementation                                       │
│      □ Path allowlist enforcement                                            │
│      □ File watching (inotify/kqueue)                                        │
│                                                                             │
│  5.2 Process Spawning                                                        │
│      □ ProcessHandle implementation                                          │
│      □ Executable allowlist enforcement                                      │
│      □ Resource limits per process                                           │
│                                                                             │
│  5.3 Network Access                                                          │
│      □ NetworkHandle implementation                                          │
│      □ Host/port allowlist enforcement                                       │
│      □ Connection pooling and limits                                         │
│                                                                             │
│  5.4 Native Plugin Support (Optional)                                        │
│      □ Native plugin loading (dlopen)                                        │
│      □ Enhanced security review process                                      │
│      □ Signed plugin verification                                            │
│                                                                             │
│  Deliverables:                                                               │
│      ✓ Plugins can access scoped filesystem                                 │
│      ✓ Plugins can spawn allowlisted processes                              │
│      ✓ Plugins can make allowlisted network connections                     │
│      ✓ IDE use case fully functional                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase 6: Ecosystem (Plugin Marketplace)

**Goal**: Build the plugin ecosystem infrastructure.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 6: ECOSYSTEM                                                          │
│  Depends on: Phase 5                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  6.1 Plugin Registry Service                                                 │
│      □ Central plugin registry (opt-in)                                     │
│      □ Plugin discovery API                                                  │
│      □ Version management                                                    │
│                                                                             │
│  6.2 Plugin Marketplace UI                                                   │
│      □ Browse/search plugins                                                 │
│      □ Install from marketplace                                              │
│      □ Reviews and ratings                                                   │
│                                                                             │
│  6.3 Plugin Development Tools                                                │
│      □ CLI for plugin scaffolding                                            │
│      □ Local development server                                              │
│      □ Testing framework                                                     │
│                                                                             │
│  6.4 Official Plugin Suite                                                   │
│      □ IDE Plugin Suite                                                      │
│      □ Infrastructure Suite                                                  │
│      □ Project Management Suite                                              │
│                                                                             │
│  Deliverables:                                                               │
│      ✓ Plugin marketplace operational                                        │
│      ✓ Third-party developers can publish plugins                           │
│      ✓ Official plugin suites available                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
