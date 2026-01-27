# Citadel Workspace Plugins - System Specification

> **Vision**: Transform Citadel Workspaces from a collaboration platform into a **programmable canvas** where organizations mirror their entire infrastructure, tooling, and workflows into secure, extensible virtual spaces.

---

## Table of Contents

1. [Philosophy & Design Principles](#1-philosophy--design-principles)
2. [Architecture Overview](#2-architecture-overview)
3. [Plugin Lifecycle](#3-plugin-lifecycle)
4. [Permission Model](#4-permission-model)
5. [Plugin Handle API](#5-plugin-handle-api)
6. [Hierarchical Signal Propagation](#6-hierarchical-signal-propagation)
7. [Plugin Types & Categories](#7-plugin-types--categories)
8. [Frontend Plugin System](#8-frontend-plugin-system)
9. [Backend Plugin System](#9-backend-plugin-system)
10. [Security Model](#10-security-model)
11. [Use Cases & Examples](#11-use-cases--examples)
12. [Implementation Roadmap](#12-implementation-roadmap)
13. [Plugin Marketplace](#13-plugin-marketplace)
14. [CitadelWorkspacePlugin Abstract Class](#14-citadelworkspaceplugin-abstract-class)
15. [Plugin Packaging Formats](#15-plugin-packaging-formats)
16. [Admin & User UX Flows](#16-admin--user-ux-flows)
17. [Scoped Capabilities](#17-scoped-capabilities)
18. [Workspace Permission Policy](#18-workspace-permission-policy)

---

## 1. Philosophy & Design Principles

### 1.1 Core Philosophy

**"The workspace becomes the canvas which the company reflects their structure onto."**

Citadel Workspaces should be:
- **Bare-boned by default** — No plugins, minimal overhead, pure collaboration
- **Infinitely extensible** — Plugins transform workspaces into anything: IDEs, dashboards, control centers
- **Permission-first** — Every plugin capability is explicitly granted, never assumed
- **Hierarchical** — Signals flow up and down the domain tree (Workspace ↔ Office ↔ Room)

### 1.2 Design Principles

| Principle | Description |
|-----------|-------------|
| **Explicit over Implicit** | Plugins declare all capabilities upfront; no runtime permission escalation |
| **Sandbox First** | Plugins run in isolated contexts; escape requires explicit grants |
| **Composable** | Plugins can depend on and extend other plugins |
| **Observable** | All plugin actions are auditable and traceable |
| **Graceful Degradation** | Plugin failures never crash the workspace |

### 1.3 What Plugins Enable

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  WORKSPACE WITHOUT PLUGINS          │  WORKSPACE WITH PLUGINS               │
├─────────────────────────────────────┼───────────────────────────────────────┤
│  • Basic P2P messaging              │  • In-browser IDE with compiler       │
│  • Simple project management        │  • Real SSH access to Server Room A   │
│  • Text/MDX content                 │  • Live dashboard mirroring prod      │
│  • Role-based permissions           │  • Automated incident escalation      │
│                                     │  • Custom workflow automation         │
│                                     │  • Third-party integrations           │
│                                     │  • Domain-specific applications       │
└─────────────────────────────────────┴───────────────────────────────────────┘
```

---

## 2. Architecture Overview

### 2.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Browser)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ UI Plugin A  │  │ UI Plugin B  │  │ UI Plugin C  │  │     ...      │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────────────┘    │
│         │                 │                 │                               │
│  ┌──────▼─────────────────▼─────────────────▼──────────────────────────┐   │
│  │                     Plugin Host (Sandbox)                            │   │
│  │  • IFrame isolation  • Permission enforcement  • Message routing     │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                           │
│  ┌──────────────────────────────▼───────────────────────────────────────┐   │
│  │                     Plugin Handle (API Surface)                       │   │
│  │  • UI Manipulation  • MDX Access  • Signal Emission  • Data Access   │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                           │
│  ┌──────────────────────────────▼───────────────────────────────────────┐   │
│  │                     Core Workspace UI (React)                         │   │
│  │  • Event Emitter  • MDX Renderer  • Component Registry               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │ WebSocket
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Server)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     Internal Service (Rust)                           │   │
│  │  • Session Management  • P2P Brokering  • Plugin Request Routing     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     Workspace Server Kernel                           │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │   │
│  │  │ Backend Plugin  │  │ Backend Plugin  │  │       ...       │       │   │
│  │  │       A         │  │       B         │  │                 │       │   │
│  │  └────────┬────────┘  └────────┬────────┘  └─────────────────┘       │   │
│  │           │                    │                                      │   │
│  │  ┌────────▼────────────────────▼─────────────────────────────────┐   │   │
│  │  │              Plugin Runtime (Sandboxed WASM or Native)         │   │   │
│  │  │  • Capability grants  • Resource limits  • Syscall filtering  │   │   │
│  │  └───────────────────────────────────────────────────────────────┘   │   │
│  │                                      │                               │   │
│  │  ┌───────────────────────────────────▼───────────────────────────┐   │   │
│  │  │              Backend Plugin Handle (API Surface)               │   │   │
│  │  │  • Filesystem  • Network  • Process  • Signals  • Data        │   │   │
│  │  └───────────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Plugin Communication Flow

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  UI Plugin  │ ──── │   Signal    │ ──── │  Backend    │
│             │      │   Bridge    │      │   Plugin    │
└─────────────┘      └─────────────┘      └─────────────┘
      │                    │                    │
      │                    ▼                    │
      │         ┌─────────────────┐             │
      │         │  Signal Router  │             │
      │         │   (Hierarchy)   │             │
      │         └─────────────────┘             │
      │                    │                    │
      ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────┐
│              Workspace Domain Tree                   │
│                                                      │
│    Workspace                                         │
│    ├── Office A                                      │
│    │   ├── Room A1  ◄─── Signal originates here     │
│    │   └── Room A2                                   │
│    └── Office B                                      │
│        └── Room B1                                   │
└─────────────────────────────────────────────────────┘
```

---

## 3. Plugin Lifecycle

### 3.1 Lifecycle Phases

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ DISCOVER │ → │ INSTALL  │ → │  INIT    │ → │  ACTIVE  │ → │ UNLOAD   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
     │              │              │              │              │
     ▼              ▼              ▼              ▼              ▼
  Registry      Admin UI      Permission      Event Loop    Cleanup
  Lookup        Approval      Validation      + Signals     Resources
```

### 3.2 Phase Details

#### Discovery
```typescript
interface PluginManifest {
  id: string;                    // Unique identifier (e.g., "com.company.ide")
  name: string;                  // Human-readable name
  version: string;               // SemVer version
  author: string;                // Plugin author/organization
  description: string;           // What this plugin does
  homepage?: string;             // Documentation URL

  // Capability declarations (permission requests)
  capabilities: PluginCapability[];

  // Dependencies on other plugins
  dependencies?: PluginDependency[];

  // Entry points
  frontend?: {
    entrypoint: string;          // JavaScript bundle URL
    styles?: string;             // CSS bundle URL
  };
  backend?: {
    entrypoint: string;          // WASM module URL or native path
    runtime: "wasm" | "native";  // Execution environment
  };

  // Domain scope (where this plugin can be installed)
  scope: "workspace" | "office" | "room";
}
```

#### Installation
```typescript
// Admin initiates installation
async function installPlugin(
  workspaceId: string,
  pluginId: string,
  config: PluginConfig
): Promise<InstallResult> {
  // 1. Fetch manifest from registry
  const manifest = await pluginRegistry.getManifest(pluginId);

  // 2. Validate capability requests against workspace policy
  const validation = await validateCapabilities(workspaceId, manifest.capabilities);
  if (!validation.approved) {
    return { status: "denied", reason: validation.reason };
  }

  // 3. Download plugin artifacts
  const artifacts = await downloadPluginArtifacts(manifest);

  // 4. Store in workspace metadata
  await workspaceStore.addPlugin(workspaceId, {
    manifest,
    artifacts,
    config,
    installedAt: Date.now(),
    installedBy: getCurrentUserId()
  });

  // 5. Initialize plugin
  return initializePlugin(workspaceId, pluginId);
}
```

#### Initialization
```typescript
interface PluginInitContext {
  // Granted capabilities (subset of requested)
  grantedCapabilities: PluginCapability[];

  // Configuration provided by admin
  config: Record<string, unknown>;

  // Domain context
  domain: {
    type: "workspace" | "office" | "room";
    id: string;
    path: string[];  // e.g., ["workspace-123", "office-456", "room-789"]
  };

  // The plugin handle (API surface)
  handle: PluginHandle;
}

// Plugin entry point signature
type PluginEntryPoint = (context: PluginInitContext) => Promise<PluginInstance>;
```

---

## 4. Permission Model

### 4.1 Capability Categories

Capabilities are organized into hierarchical categories with increasing privilege levels:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CAPABILITY HIERARCHY (Increasing Privilege)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Level 0: OBSERVE (Read-Only)                                               │
│  ├── ui:read           Read UI state, observe events                        │
│  ├── domain:read       Read workspace/office/room data                      │
│  ├── members:read      Read member list and roles                           │
│  └── signals:subscribe Listen to signals in current domain                  │
│                                                                             │
│  Level 1: INTERACT (User-Scoped)                                            │
│  ├── ui:components     Register custom MDX components                       │
│  ├── ui:panels         Add sidebar/panel UI                                 │
│  ├── messages:send     Send P2P messages as current user                    │
│  └── signals:emit      Emit signals within current domain                   │
│                                                                             │
│  Level 2: MODIFY (Domain-Scoped)                                            │
│  ├── ui:inject         Modify existing UI elements (innerHTML)              │
│  ├── mdx:edit          Edit MDX content in offices/rooms                    │
│  ├── domain:write      Update domain metadata                               │
│  └── signals:propagate Propagate signals up/down hierarchy                  │
│                                                                             │
│  Level 3: MANAGE (Admin-Scoped)                                             │
│  ├── members:manage    Add/remove members, change roles                     │
│  ├── domain:create     Create offices/rooms                                 │
│  ├── domain:delete     Delete offices/rooms                                 │
│  └── plugins:configure Configure other plugins                              │
│                                                                             │
│  Level 4: SYSTEM (Server-Scoped) ⚠️ HIGH PRIVILEGE                          │
│  ├── fs:read           Read server filesystem (scoped paths)                │
│  ├── fs:write          Write server filesystem (scoped paths)               │
│  ├── process:spawn     Spawn server processes (allowlisted)                 │
│  ├── network:connect   Make external network connections                    │
│  └── signals:broadcast Broadcast signals across all domains                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Capability Definition

```rust
/// Backend capability definitions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PluginCapability {
    // Level 0: Observe
    UiRead,
    DomainRead { domain_ids: Vec<String> },
    MembersRead { domain_ids: Vec<String> },
    SignalsSubscribe { patterns: Vec<String> },

    // Level 1: Interact
    UiComponents { component_names: Vec<String> },
    UiPanels { panel_locations: Vec<PanelLocation> },
    MessagesSend { peer_cids: Option<Vec<u64>> },  // None = all peers
    SignalsEmit { patterns: Vec<String> },

    // Level 2: Modify
    UiInject { selectors: Vec<String> },
    MdxEdit { domain_ids: Vec<String> },
    DomainWrite { domain_ids: Vec<String> },
    SignalsPropagate { directions: Vec<PropagationDirection> },

    // Level 3: Manage
    MembersManage { domain_ids: Vec<String> },
    DomainCreate { parent_ids: Vec<String> },
    DomainDelete { domain_ids: Vec<String> },
    PluginsConfigure { plugin_ids: Vec<String> },

    // Level 4: System (requires explicit admin approval)
    FsRead { paths: Vec<PathBuf>, recursive: bool },
    FsWrite { paths: Vec<PathBuf> },
    ProcessSpawn { allowlist: Vec<ProcessAllowEntry> },
    NetworkConnect { hosts: Vec<String>, ports: Vec<u16> },
    SignalsBroadcast,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessAllowEntry {
    pub executable: String,
    pub args_pattern: Option<String>,  // Regex for allowed arguments
    pub working_dir: Option<PathBuf>,
    pub env_allowlist: Vec<String>,
}
```

### 4.3 Permission Inheritance

```
┌─────────────────────────────────────────────────────────────────┐
│  PERMISSION INHERITANCE MODEL                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Workspace Plugin Permissions                                    │
│       │                                                          │
│       ├──► Office A (inherits workspace perms by default)        │
│       │         │                                                │
│       │         ├──► Room A1 (inherits office perms)             │
│       │         │         Plugin can access if:                  │
│       │         │         - Workspace granted capability         │
│       │         │         - Office didn't revoke                 │
│       │         │         - Room didn't revoke                   │
│       │         │                                                │
│       │         └──► Room A2 (can override/restrict)             │
│       │                     Office admin blocked plugin          │
│       │                                                          │
│       └──► Office B (admin restricted plugin scope)              │
│                 Plugin cannot access Office B domains            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Plugin Handle API

The Plugin Handle is the primary API surface exposed to plugins. It provides capability-gated access to workspace functionality.

### 5.1 Handle Architecture

```typescript
interface PluginHandle {
  // Identity
  readonly pluginId: string;
  readonly instanceId: string;
  readonly domain: DomainContext;

  // Capability checking
  hasCapability(capability: PluginCapability): boolean;
  requestCapability(capability: PluginCapability): Promise<boolean>;

  // Sub-handles (capability-gated)
  readonly ui: UIHandle | null;
  readonly mdx: MDXHandle | null;
  readonly signals: SignalHandle | null;
  readonly data: DataHandle | null;
  readonly members: MembersHandle | null;
  readonly fs: FileSystemHandle | null;      // Level 4
  readonly process: ProcessHandle | null;    // Level 4
  readonly network: NetworkHandle | null;    // Level 4
}
```

### 5.2 UI Handle

```typescript
interface UIHandle {
  // Component Registration (Level 1)
  registerComponent(name: string, component: React.ComponentType<any>): void;
  unregisterComponent(name: string): void;

  // Panel Registration (Level 1)
  registerPanel(config: PanelConfig): PanelInstance;

  // DOM Injection (Level 2)
  inject(selector: string, content: InjectableContent): InjectionHandle;

  // Event Observation (Level 0)
  onEvent<T extends UIEvent>(
    event: T["type"],
    handler: (event: T) => void
  ): () => void;

  // State Reading (Level 0)
  getState(): UIState;

  // Theming (Level 1)
  registerTheme(theme: ThemeDefinition): void;
}

interface PanelConfig {
  id: string;
  title: string;
  location: "sidebar-left" | "sidebar-right" | "bottom" | "modal" | "floating";
  component: React.ComponentType<PanelProps>;
  icon?: React.ComponentType;
  defaultVisible?: boolean;
  resizable?: boolean;
  minWidth?: number;
  maxWidth?: number;
}

type InjectableContent =
  | { type: "html"; html: string }
  | { type: "component"; component: React.ComponentType<any>; props?: any }
  | { type: "widget"; widgetId: string; config?: any };

interface InjectionHandle {
  update(content: InjectableContent): void;
  remove(): void;
  readonly isActive: boolean;
}
```

### 5.3 MDX Handle

```typescript
interface MDXHandle {
  // Reading (Level 0)
  getContent(domainId: string): Promise<string>;

  // Editing (Level 2)
  setContent(domainId: string, content: string): Promise<void>;
  patchContent(domainId: string, patches: MDXPatch[]): Promise<void>;

  // Live Editing (Level 2)
  createEditSession(domainId: string): MDXEditSession;

  // Component Context (Level 1)
  registerMdxComponent(name: string, component: React.ComponentType<any>): void;

  // Transformation (Level 2)
  registerTransformer(transformer: MDXTransformer): void;
}

interface MDXPatch {
  type: "insert" | "delete" | "replace";
  range: { start: number; end: number };
  content?: string;
}

interface MDXEditSession {
  readonly domainId: string;
  readonly content: string;

  onChange(handler: (content: string) => void): () => void;
  applyPatch(patch: MDXPatch): void;
  save(): Promise<void>;
  discard(): void;
}

interface MDXTransformer {
  name: string;
  priority: number;  // Higher runs first
  transform(ast: MDXAst, context: TransformContext): MDXAst;
}
```

### 5.4 Signal Handle

```typescript
interface SignalHandle {
  // Subscription (Level 0)
  subscribe<T extends Signal>(
    pattern: string,
    handler: (signal: T) => void
  ): () => void;

  // Emission (Level 1)
  emit<T extends Signal>(signal: T): void;

  // Propagation (Level 2)
  propagate<T extends Signal>(
    signal: T,
    direction: PropagationDirection,
    options?: PropagationOptions
  ): void;

  // Broadcast (Level 4)
  broadcast<T extends Signal>(signal: T): void;
}

type PropagationDirection = "up" | "down" | "both" | "siblings";

interface PropagationOptions {
  stopAt?: string[];        // Domain IDs to stop at
  skipDomains?: string[];   // Domain IDs to skip
  transform?: (signal: Signal, domain: Domain) => Signal | null;
}
```

### 5.5 Data Handle

```typescript
interface DataHandle {
  // Domain Data (Level 0/2)
  getWorkspace(): Promise<Workspace>;
  getOffice(officeId: string): Promise<Office>;
  getRoom(roomId: string): Promise<Room>;

  // Updates require Level 2
  updateWorkspace(updates: Partial<WorkspaceUpdate>): Promise<void>;
  updateOffice(officeId: string, updates: Partial<OfficeUpdate>): Promise<void>;
  updateRoom(roomId: string, updates: Partial<RoomUpdate>): Promise<void>;

  // Plugin-specific storage
  readonly storage: PluginStorage;
}

interface PluginStorage {
  // Scoped to plugin + domain
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;

  // Cross-domain storage (requires Level 3)
  global: GlobalPluginStorage;
}
```

### 5.6 FileSystem Handle (Level 4)

```typescript
interface FileSystemHandle {
  // Scoped to allowed paths only
  readonly allowedPaths: readonly string[];

  // Reading
  readFile(path: string): Promise<Uint8Array>;
  readTextFile(path: string): Promise<string>;
  readDir(path: string): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;

  // Writing (if fs:write granted)
  writeFile(path: string, content: Uint8Array): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
  mkdir(path: string, options?: MkdirOptions): Promise<void>;
  remove(path: string, options?: RemoveOptions): Promise<void>;
  rename(from: string, to: string): Promise<void>;

  // Watching
  watch(path: string, handler: (event: FsEvent) => void): () => void;
}
```

### 5.7 Process Handle (Level 4)

```typescript
interface ProcessHandle {
  // Scoped to allowlisted executables only
  readonly allowedExecutables: readonly ProcessAllowEntry[];

  spawn(config: SpawnConfig): Promise<ProcessInstance>;
}

interface SpawnConfig {
  executable: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "pipe" | "inherit" | "null";
  stdout?: "pipe" | "inherit" | "null";
  stderr?: "pipe" | "inherit" | "null";
}

interface ProcessInstance {
  readonly pid: number;
  readonly stdin: WritableStream<Uint8Array> | null;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;

  wait(): Promise<ProcessOutput>;
  kill(signal?: number): void;
}
```

---

## 6. Hierarchical Signal Propagation

### 6.1 Signal System Overview

The signal system enables event-driven communication across the domain hierarchy. This is critical for:
- **Incident escalation** (Room → Office → Workspace)
- **Command delegation** (Workspace → Office → Room)
- **Cross-domain coordination** (Sibling offices/rooms)
- **Audit trails** (All signals logged)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SIGNAL PROPAGATION FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   UPWARD (Escalation)              DOWNWARD (Delegation)                    │
│                                                                             │
│   ┌──────────────┐                 ┌──────────────┐                         │
│   │  Workspace   │ ◄───────────── │  Workspace   │                         │
│   │   Admin      │    Escalated   │   Admin      │                         │
│   └──────┬───────┘    Signal      └──────┬───────┘                         │
│          │                               │                                  │
│   ┌──────┴───────┐    Queued      ┌──────▼───────┐    Command              │
│   │   Office A   │ ◄─ for ─────── │   Office A   │                         │
│   │   Manager    │   Review       │   Manager    │                         │
│   └──────┬───────┘                └──────┬───────┘                         │
│          │                               │                                  │
│   ┌──────┴───────┐    Signal      ┌──────▼───────┐    Delegated            │
│   │   Room A1    │ ◄─ Origin ──── │   Room A1    │ ◄─ Task                 │
│   │   (Issue!)   │                │   (Execute)  │                         │
│   └──────────────┘                └──────────────┘                         │
│                                                                             │
│   SIBLING (Coordination)           BROADCAST (Announcement)                 │
│                                                                             │
│   ┌──────────────┐                 ┌──────────────┐                         │
│   │   Office A   │ ◄───────────── │  Workspace   │ ────► All Domains       │
│   └──────────────┘    Sibling     └──────────────┘                         │
│          │            Signal                                                │
│   ┌──────▼───────┐                                                          │
│   │   Office B   │                                                          │
│   └──────────────┘                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Signal Definition

```rust
/// Signal structure for hierarchical propagation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    /// Unique signal identifier
    pub id: Uuid,

    /// Signal type (namespaced, e.g., "plugin.ide.compile-error")
    pub signal_type: String,

    /// Origin domain
    pub origin: DomainPath,

    /// Current domain (changes as signal propagates)
    pub current: DomainPath,

    /// Signal payload (arbitrary JSON)
    pub payload: serde_json::Value,

    /// Signal metadata
    pub metadata: SignalMetadata,

    /// Propagation history
    pub history: Vec<PropagationEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalMetadata {
    pub created_at: i64,
    pub created_by: UserId,
    pub priority: SignalPriority,
    pub ttl: Option<i64>,  // Time-to-live in ms
    pub requires_ack: bool,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum SignalPriority {
    Low,
    Normal,
    High,
    Critical,  // Bypasses queues, immediate delivery
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropagationEntry {
    pub domain: DomainPath,
    pub action: PropagationAction,
    pub timestamp: i64,
    pub actor: Option<UserId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PropagationAction {
    Received,
    Queued,
    Acknowledged,
    Escalated { reason: String },
    Delegated { assignee: UserId },
    Completed { result: serde_json::Value },
    Dropped { reason: String },
}
```

### 6.3 Signal Router

```rust
/// Signal routing engine
pub struct SignalRouter {
    /// Domain hierarchy index
    hierarchy: DomainHierarchy,

    /// Active subscriptions
    subscriptions: HashMap<String, Vec<Subscription>>,

    /// Signal queues per domain
    queues: HashMap<DomainPath, SignalQueue>,

    /// Audit log
    audit_log: AuditLog,
}

impl SignalRouter {
    /// Emit a signal within a domain
    pub async fn emit(&self, signal: Signal) -> Result<(), SignalError> {
        // 1. Validate signal
        self.validate_signal(&signal)?;

        // 2. Deliver to local subscribers
        self.deliver_local(&signal).await?;

        // 3. Log to audit trail
        self.audit_log.record(&signal, PropagationAction::Received).await?;

        Ok(())
    }

    /// Propagate a signal through the hierarchy
    pub async fn propagate(
        &self,
        signal: Signal,
        direction: PropagationDirection,
        options: PropagationOptions,
    ) -> Result<PropagationResult, SignalError> {
        match direction {
            PropagationDirection::Up => self.propagate_up(signal, options).await,
            PropagationDirection::Down => self.propagate_down(signal, options).await,
            PropagationDirection::Siblings => self.propagate_siblings(signal, options).await,
            PropagationDirection::Both => {
                let up = self.propagate_up(signal.clone(), options.clone()).await?;
                let down = self.propagate_down(signal, options).await?;
                Ok(PropagationResult::merge(up, down))
            }
        }
    }

    async fn propagate_up(
        &self,
        mut signal: Signal,
        options: PropagationOptions,
    ) -> Result<PropagationResult, SignalError> {
        let mut result = PropagationResult::new();
        let mut current = signal.current.clone();

        while let Some(parent) = self.hierarchy.parent(&current) {
            // Check stop conditions
            if options.stop_at.contains(&parent) {
                break;
            }
            if options.skip_domains.contains(&parent) {
                current = parent;
                continue;
            }

            // Apply transformation
            if let Some(ref transform) = options.transform {
                let domain = self.hierarchy.get(&parent)?;
                match transform(&signal, &domain) {
                    Some(transformed) => signal = transformed,
                    None => break,  // Transform returned None, stop propagation
                }
            }

            // Update signal location
            signal.current = parent.clone();
            signal.history.push(PropagationEntry {
                domain: parent.clone(),
                action: PropagationAction::Received,
                timestamp: now(),
                actor: None,
            });

            // Queue for admin review or deliver immediately
            if signal.metadata.requires_ack {
                self.queue_for_review(&parent, &signal).await?;
                result.queued.push(parent.clone());
            } else {
                self.deliver_local(&signal).await?;
                result.delivered.push(parent.clone());
            }

            current = parent;
        }

        Ok(result)
    }
}
```

### 6.4 Signal Patterns for Common Use Cases

#### Incident Escalation
```typescript
// Room-level: Server alert detected
signals.emit({
  type: "infrastructure.alert",
  payload: {
    severity: "critical",
    server: "prod-db-01",
    message: "High CPU usage (95%)",
    metrics: { cpu: 95, memory: 78 }
  },
  metadata: { priority: "critical", requires_ack: true }
});

// Propagate upward for escalation
signals.propagate(signal, "up", {
  transform: (signal, domain) => {
    // Enrich with domain context
    return {
      ...signal,
      payload: {
        ...signal.payload,
        escalation_path: [...signal.payload.escalation_path, domain.name]
      }
    };
  }
});
```

#### Command Delegation
```typescript
// Workspace-level: Deploy command from admin
signals.emit({
  type: "deployment.trigger",
  payload: {
    version: "2.3.0",
    environment: "production",
    rollback_on_failure: true
  }
});

// Propagate downward to relevant rooms
signals.propagate(signal, "down", {
  stopAt: ["room-staging"],  // Don't propagate to staging
  transform: (signal, domain) => {
    // Only propagate to rooms with deployment capability
    if (domain.metadata.has_deployment_plugin) {
      return signal;
    }
    return null;  // Skip this domain
  }
});
```

#### Cross-Office Coordination
```typescript
// Engineering office signals to QA office
signals.propagate({
  type: "build.ready-for-qa",
  payload: {
    build_id: "build-12345",
    branch: "feature/new-login",
    test_plan_url: "https://..."
  }
}, "siblings", {
  filter: (domain) => domain.name.includes("QA")
});
```

---

## 7. Plugin Types & Categories

### 7.1 Plugin Type Taxonomy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PLUGIN TYPE TAXONOMY                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────┐                                                   │
│  │   UI PLUGINS         │  Frontend-only, extend visual interface           │
│  │   (Level 0-2)        │                                                   │
│  ├──────────────────────┤                                                   │
│  │  • Dashboard widgets │                                                   │
│  │  • Custom panels     │                                                   │
│  │  • Theme extensions  │                                                   │
│  │  • MDX components    │                                                   │
│  └──────────────────────┘                                                   │
│                                                                             │
│  ┌──────────────────────┐                                                   │
│  │   SERVICE PLUGINS    │  Backend services, process data                   │
│  │   (Level 2-4)        │                                                   │
│  ├──────────────────────┤                                                   │
│  │  • Data processors   │                                                   │
│  │  • API gateways      │                                                   │
│  │  • Storage backends  │                                                   │
│  │  • Cron schedulers   │                                                   │
│  └──────────────────────┘                                                   │
│                                                                             │
│  ┌──────────────────────┐                                                   │
│  │   INTEGRATION        │  Bridge external systems                          │
│  │   PLUGINS (Level 3-4)│                                                   │
│  ├──────────────────────┤                                                   │
│  │  • SSH connectors    │                                                   │
│  │  • Cloud API bridges │                                                   │
│  │  • Database links    │                                                   │
│  │  • Webhook handlers  │                                                   │
│  └──────────────────────┘                                                   │
│                                                                             │
│  ┌──────────────────────┐                                                   │
│  │   WORKFLOW PLUGINS   │  Automation and orchestration                     │
│  │   (Level 2-3)        │                                                   │
│  ├──────────────────────┤                                                   │
│  │  • Approval flows    │                                                   │
│  │  • Notification bots │                                                   │
│  │  • Incident routing  │                                                   │
│  │  • Auto-responders   │                                                   │
│  └──────────────────────┘                                                   │
│                                                                             │
│  ┌──────────────────────┐                                                   │
│  │   COMPOSITE PLUGINS  │  Full applications built from others              │
│  │   (Variable levels)  │                                                   │
│  ├──────────────────────┤                                                   │
│  │  • In-browser IDE    │                                                   │
│  │  • DevOps dashboard  │                                                   │
│  │  • Project manager   │                                                   │
│  │  • Monitoring suite  │                                                   │
│  └──────────────────────┘                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Plugin Examples by Category

#### UI Plugin: Custom Dashboard Widget
```typescript
// Manifest
{
  id: "com.example.server-status-widget",
  name: "Server Status Widget",
  capabilities: [
    { type: "ui:components", component_names: ["ServerStatusWidget"] },
    { type: "signals:subscribe", patterns: ["infrastructure.*"] }
  ],
  frontend: { entrypoint: "/plugins/server-status/bundle.js" }
}

// Implementation
export default async function init(ctx: PluginInitContext): Promise<PluginInstance> {
  const { handle } = ctx;

  // Register the MDX component
  handle.ui.registerComponent("ServerStatusWidget", ({ serverId }) => {
    const [status, setStatus] = useState<ServerStatus | null>(null);

    useEffect(() => {
      return handle.signals.subscribe("infrastructure.status.*", (signal) => {
        if (signal.payload.serverId === serverId) {
          setStatus(signal.payload);
        }
      });
    }, [serverId]);

    return (
      <Card>
        <CardHeader>Server: {serverId}</CardHeader>
        <CardContent>
          <StatusIndicator status={status?.health} />
          <Metrics cpu={status?.cpu} memory={status?.memory} />
        </CardContent>
      </Card>
    );
  });

  return { cleanup: () => handle.ui.unregisterComponent("ServerStatusWidget") };
}
```

#### Service Plugin: Build Compiler
```rust
// Manifest
{
  id: "com.example.rust-compiler",
  name: "Rust Compiler Service",
  capabilities: [
    { type: "fs:read", paths: ["/workspace/src"], recursive: true },
    { type: "fs:write", paths: ["/workspace/target"] },
    { type: "process:spawn", allowlist: [
      { executable: "cargo", args_pattern: "build.*|check.*|clippy.*" }
    ]},
    { type: "signals:emit", patterns: ["build.*"] }
  ],
  backend: { entrypoint: "/plugins/rust-compiler/plugin.wasm", runtime: "wasm" }
}

// Implementation (Rust compiled to WASM)
pub struct RustCompilerPlugin {
    handle: PluginHandle,
}

impl Plugin for RustCompilerPlugin {
    async fn init(ctx: PluginInitContext) -> Result<Self, PluginError> {
        let plugin = Self { handle: ctx.handle };

        // Subscribe to build requests
        plugin.handle.signals.subscribe("build.request.rust", |signal| {
            let build_config: BuildConfig = serde_json::from_value(signal.payload)?;
            plugin.compile(build_config).await
        });

        Ok(plugin)
    }

    async fn compile(&self, config: BuildConfig) -> Result<(), PluginError> {
        // Emit build started
        self.handle.signals.emit(Signal {
            signal_type: "build.started".into(),
            payload: json!({ "config": config }),
            ..Default::default()
        });

        // Spawn cargo build
        let process = self.handle.process.spawn(SpawnConfig {
            executable: "cargo".into(),
            args: vec!["build".into(), "--release".into()],
            cwd: Some("/workspace".into()),
            ..Default::default()
        }).await?;

        let output = process.wait().await?;

        // Emit result
        self.handle.signals.emit(Signal {
            signal_type: if output.success { "build.succeeded" } else { "build.failed" }.into(),
            payload: json!({
                "exit_code": output.code,
                "stdout": String::from_utf8_lossy(&output.stdout),
                "stderr": String::from_utf8_lossy(&output.stderr),
            }),
            ..Default::default()
        });

        Ok(())
    }
}
```

#### Integration Plugin: SSH Connector
```rust
// Manifest
{
  id: "com.example.ssh-connector",
  name: "SSH Server Connector",
  capabilities: [
    { type: "network:connect", hosts: ["10.0.0.*"], ports: [22] },
    { type: "ui:panels", panel_locations: ["sidebar-right"] },
    { type: "signals:emit", patterns: ["ssh.*"] }
  ],
  frontend: { entrypoint: "/plugins/ssh/ui.js" },
  backend: { entrypoint: "/plugins/ssh/connector.wasm", runtime: "wasm" }
}

// This plugin enables:
// - Real SSH terminal in the workspace UI
// - Server health monitoring
// - Command execution with audit logging
// - Integration with incident escalation signals
```

#### Workflow Plugin: Incident Router
```typescript
// Manifest
{
  id: "com.example.incident-router",
  name: "Incident Routing Bot",
  capabilities: [
    { type: "signals:subscribe", patterns: ["infrastructure.alert.*"] },
    { type: "signals:propagate", directions: ["up", "siblings"] },
    { type: "members:read" },
    { type: "messages:send" }
  ]
}

// Implementation
export default async function init(ctx: PluginInitContext): Promise<PluginInstance> {
  const { handle } = ctx;

  // Subscribe to infrastructure alerts
  handle.signals.subscribe("infrastructure.alert.*", async (signal) => {
    const severity = signal.payload.severity;

    if (severity === "critical") {
      // Immediately escalate critical alerts
      handle.signals.propagate(signal, "up", {
        transform: (s, domain) => ({
          ...s,
          metadata: { ...s.metadata, requires_ack: true }
        })
      });

      // Notify on-call engineer
      const oncall = await getOncallEngineer(handle);
      await handle.messages.sendDirect(oncall.cid, {
        type: "alert",
        content: `Critical alert: ${signal.payload.message}`
      });
    } else if (severity === "warning") {
      // Queue for review, don't escalate immediately
      handle.signals.emit({
        ...signal,
        signal_type: "incident.queued",
        metadata: { ...signal.metadata, requires_ack: true }
      });
    }
  });

  return { cleanup: () => {} };
}
```

---

## 8. Frontend Plugin System

### 8.1 Plugin Host Architecture

```typescript
// Plugin isolation using iframes with controlled message passing
class PluginHost {
  private plugins: Map<string, PluginInstance> = new Map();
  private sandbox: HTMLIFrameElement;
  private messageChannel: MessageChannel;

  async loadPlugin(manifest: PluginManifest): Promise<void> {
    // Create sandboxed iframe
    this.sandbox = document.createElement("iframe");
    this.sandbox.sandbox.add("allow-scripts");
    this.sandbox.sandbox.add("allow-same-origin");  // Required for WASM

    // Set up secure message channel
    this.messageChannel = new MessageChannel();

    // Load plugin bundle
    const response = await fetch(manifest.frontend.entrypoint);
    const code = await response.text();

    // Inject into sandbox with controlled API surface
    const wrappedCode = this.wrapPluginCode(code, manifest.capabilities);
    this.sandbox.srcdoc = `
      <script type="module">
        ${wrappedCode}
      </script>
    `;

    document.body.appendChild(this.sandbox);

    // Wait for plugin to signal ready
    await this.waitForReady();
  }

  private wrapPluginCode(code: string, capabilities: PluginCapability[]): string {
    // Generate capability-filtered API
    const apiSurface = this.generateApiSurface(capabilities);

    return `
      const __pluginHandle = ${JSON.stringify(apiSurface)};
      const __pluginApi = new PluginApi(__pluginHandle);

      ${code}

      // Initialize plugin with filtered handle
      if (typeof init === 'function') {
        init({ handle: __pluginApi });
      }
    `;
  }
}
```

### 8.2 MDX Component Registry Integration

```typescript
// Integration with existing MDX component registry
// File: citadel-workspaces/src/components/office/mdxComponents.tsx

import { pluginComponents } from "@/lib/plugin-registry";

export const components = {
  // Core components
  h1, h2, p, ul, li, a, img,
  table, thead, tbody, tr, th, td,

  // Built-in custom components
  Card, Alert, Badge,
  code, pre,

  // Plugin-provided components (dynamically registered)
  ...pluginComponents.getAll()
};

// Plugin registry
// File: citadel-workspaces/src/lib/plugin-registry.ts

class PluginComponentRegistry {
  private components: Map<string, React.ComponentType<any>> = new Map();
  private listeners: Set<() => void> = new Set();

  register(name: string, component: React.ComponentType<any>, pluginId: string): void {
    // Validate component name doesn't conflict with built-ins
    if (BUILTIN_COMPONENTS.has(name)) {
      throw new Error(`Cannot override built-in component: ${name}`);
    }

    // Namespace plugin components to prevent conflicts
    const namespacedName = `${pluginId}.${name}`;
    this.components.set(namespacedName, component);

    // Also register short name if unambiguous
    if (!this.components.has(name)) {
      this.components.set(name, component);
    }

    this.notifyListeners();
  }

  getAll(): Record<string, React.ComponentType<any>> {
    return Object.fromEntries(this.components);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const pluginComponents = new PluginComponentRegistry();
```

### 8.3 Event Integration

```typescript
// Integration with existing event emitter system
// File: citadel-workspaces/src/lib/plugin-events.ts

import { eventEmitter } from "./event-emitter";

// Bridge between plugin signals and workspace events
class PluginEventBridge {
  private subscriptions: Map<string, () => void> = new Map();

  // Forward workspace events to plugin signal system
  forwardToPlugin(workspaceEvent: string, signalPattern: string): void {
    const unsubscribe = eventEmitter.on(workspaceEvent, (payload) => {
      signalRouter.emit({
        signal_type: signalPattern,
        payload,
        origin: getCurrentDomain(),
        current: getCurrentDomain(),
        metadata: {
          created_at: Date.now(),
          created_by: getCurrentUserId(),
          priority: "normal"
        }
      });
    });

    this.subscriptions.set(`${workspaceEvent}->${signalPattern}`, unsubscribe);
  }

  // Forward plugin signals to workspace events
  forwardToWorkspace(signalPattern: string, workspaceEvent: string): void {
    signalRouter.subscribe(signalPattern, (signal) => {
      eventEmitter.emit(workspaceEvent, signal.payload);
    });
  }
}

export const pluginEventBridge = new PluginEventBridge();

// Default bridges for common events
pluginEventBridge.forwardToPlugin("office-content-updated", "workspace.office.content-updated");
pluginEventBridge.forwardToPlugin("room-content-updated", "workspace.room.content-updated");
pluginEventBridge.forwardToPlugin("member-joined", "workspace.member.joined");
pluginEventBridge.forwardToPlugin("message-received", "workspace.message.received");
```

---

## 9. Backend Plugin System

### 9.1 Plugin Runtime Architecture

```rust
// Plugin runtime supporting both WASM and native plugins
// File: citadel-workspace-server-kernel/src/plugins/runtime.rs

pub enum PluginRuntime {
    Wasm(WasmPluginRuntime),
    Native(NativePluginRuntime),
}

pub struct WasmPluginRuntime {
    engine: wasmtime::Engine,
    store: wasmtime::Store<PluginState>,
    module: wasmtime::Module,
    instance: wasmtime::Instance,
}

impl WasmPluginRuntime {
    pub async fn new(
        wasm_bytes: &[u8],
        capabilities: &[PluginCapability],
    ) -> Result<Self, PluginError> {
        let mut config = wasmtime::Config::new();
        config.async_support(true);
        config.consume_fuel(true);  // Resource limiting

        let engine = wasmtime::Engine::new(&config)?;
        let module = wasmtime::Module::new(&engine, wasm_bytes)?;

        let mut store = wasmtime::Store::new(&engine, PluginState::new(capabilities));
        store.add_fuel(INITIAL_FUEL)?;

        // Link capability-filtered host functions
        let linker = Self::create_linker(&engine, capabilities)?;
        let instance = linker.instantiate_async(&mut store, &module).await?;

        Ok(Self { engine, store, module, instance })
    }

    fn create_linker(
        engine: &wasmtime::Engine,
        capabilities: &[PluginCapability],
    ) -> Result<wasmtime::Linker<PluginState>, PluginError> {
        let mut linker = wasmtime::Linker::new(engine);

        // Always available: logging, time
        linker.func_wrap_async("env", "log", |caller, level: i32, msg_ptr: i32, msg_len: i32| {
            Box::new(async move { /* ... */ })
        })?;

        // Capability-gated functions
        if capabilities.contains(&PluginCapability::FsRead { .. }) {
            linker.func_wrap_async("fs", "read_file", |caller, path_ptr, path_len| {
                Box::new(async move { /* ... */ })
            })?;
        }

        if capabilities.contains(&PluginCapability::ProcessSpawn { .. }) {
            linker.func_wrap_async("process", "spawn", |caller, config_ptr, config_len| {
                Box::new(async move { /* ... */ })
            })?;
        }

        // ... more capability-gated functions

        Ok(linker)
    }
}
```

### 9.2 Plugin Trait Definition

```rust
// Core plugin trait
// File: citadel-workspace-server-kernel/src/plugins/traits.rs

#[async_trait]
pub trait Plugin: Send + Sync {
    /// Plugin metadata
    fn manifest(&self) -> &PluginManifest;

    /// Initialize the plugin with granted capabilities
    async fn init(&mut self, ctx: PluginContext) -> Result<(), PluginError>;

    /// Shutdown the plugin gracefully
    async fn shutdown(&mut self) -> Result<(), PluginError>;

    /// Health check
    async fn health_check(&self) -> PluginHealth;
}

/// Plugin hooks for workspace events
#[async_trait]
pub trait PluginHooks: Plugin {
    /// Called before a workspace request is processed
    async fn on_before_request(
        &self,
        request: &WorkspaceProtocolRequest,
        user: &User,
    ) -> Result<HookResult, PluginError> {
        Ok(HookResult::Continue)
    }

    /// Called after a workspace request is processed
    async fn on_after_request(
        &self,
        request: &WorkspaceProtocolRequest,
        response: &WorkspaceProtocolResponse,
        user: &User,
    ) -> Result<(), PluginError> {
        Ok(())
    }

    /// Called when a member is added to a domain
    async fn on_member_added(
        &self,
        user: &User,
        domain: &Domain,
    ) -> Result<(), PluginError> {
        Ok(())
    }

    /// Called when a signal is received in this plugin's domain
    async fn on_signal(&self, signal: &Signal) -> Result<(), PluginError> {
        Ok(())
    }
}

pub enum HookResult {
    Continue,                           // Proceed with normal processing
    Intercept(WorkspaceProtocolResponse), // Return this response instead
    Reject(String),                     // Reject the request with error
}
```

### 9.3 Plugin Registry

```rust
// Plugin registry for the workspace server kernel
// File: citadel-workspace-server-kernel/src/plugins/registry.rs

pub struct PluginRegistry {
    plugins: RwLock<HashMap<String, Arc<dyn Plugin>>>,
    manifests: RwLock<HashMap<String, PluginManifest>>,
    hooks: RwLock<HookRegistry>,
}

impl PluginRegistry {
    pub async fn install(
        &self,
        manifest: PluginManifest,
        workspace_id: &str,
        admin_user_id: &str,
    ) -> Result<(), PluginError> {
        // 1. Validate capabilities against workspace policy
        self.validate_capabilities(&manifest, workspace_id).await?;

        // 2. Load plugin runtime
        let runtime = match &manifest.backend {
            Some(backend) => match backend.runtime {
                PluginRuntimeType::Wasm => {
                    let bytes = self.fetch_plugin_bytes(&backend.entrypoint).await?;
                    Some(PluginRuntime::Wasm(
                        WasmPluginRuntime::new(&bytes, &manifest.capabilities).await?
                    ))
                }
                PluginRuntimeType::Native => {
                    // Native plugins require additional security review
                    if !self.is_native_plugin_allowed(workspace_id) {
                        return Err(PluginError::NativePluginsDisabled);
                    }
                    Some(PluginRuntime::Native(
                        NativePluginRuntime::load(&backend.entrypoint).await?
                    ))
                }
            }
            None => None,  // Frontend-only plugin
        };

        // 3. Create plugin instance
        let plugin = PluginInstance::new(manifest.clone(), runtime);

        // 4. Initialize plugin
        let ctx = PluginContext {
            workspace_id: workspace_id.to_string(),
            capabilities: manifest.capabilities.clone(),
            handle: self.create_handle(&manifest).await?,
        };
        plugin.init(ctx).await?;

        // 5. Register hooks
        if let Some(hooks) = plugin.hooks() {
            self.hooks.write().await.register(&manifest.id, hooks);
        }

        // 6. Store in registry
        self.plugins.write().await.insert(manifest.id.clone(), Arc::new(plugin));
        self.manifests.write().await.insert(manifest.id.clone(), manifest);

        Ok(())
    }

    pub async fn execute_before_hooks(
        &self,
        request: &WorkspaceProtocolRequest,
        user: &User,
    ) -> Result<Option<WorkspaceProtocolResponse>, PluginError> {
        let hooks = self.hooks.read().await;

        for (plugin_id, hook) in hooks.before_request.iter() {
            match hook.on_before_request(request, user).await? {
                HookResult::Continue => continue,
                HookResult::Intercept(response) => return Ok(Some(response)),
                HookResult::Reject(reason) => {
                    return Ok(Some(WorkspaceProtocolResponse::Error(reason)));
                }
            }
        }

        Ok(None)
    }
}
```

---

## 10. Security Model

### 10.1 Security Principles

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PLUGIN SECURITY MODEL                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PRINCIPLE 1: Least Privilege                                               │
│  ─────────────────────────────                                              │
│  • Plugins request only capabilities they need                              │
│  • Admins can deny any capability                                           │
│  • Capabilities cannot be escalated at runtime                              │
│                                                                             │
│  PRINCIPLE 2: Defense in Depth                                              │
│  ─────────────────────────────                                              │
│  • WASM sandbox for code isolation                                          │
│  • Capability filtering at API boundary                                     │
│  • Resource limits (CPU, memory, network)                                   │
│  • Audit logging of all plugin actions                                      │
│                                                                             │
│  PRINCIPLE 3: Fail Secure                                                   │
│  ─────────────────────────────                                              │
│  • Plugin failures don't crash workspace                                    │
│  • Undefined capabilities default to denied                                 │
│  • Network failures don't leak internal state                               │
│                                                                             │
│  PRINCIPLE 4: Auditability                                                  │
│  ─────────────────────────────                                              │
│  • All plugin actions logged with timestamps                                │
│  • Signal propagation history preserved                                     │
│  • Capability usage metrics tracked                                         │
│  • Admin can review plugin activity                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Capability Validation

```rust
// Capability validation pipeline
// File: citadel-workspace-server-kernel/src/plugins/security.rs

pub struct CapabilityValidator {
    workspace_policy: WorkspacePolicy,
    plugin_manifest: PluginManifest,
}

impl CapabilityValidator {
    pub fn validate(&self) -> ValidationResult {
        let mut result = ValidationResult::new();

        for capability in &self.plugin_manifest.capabilities {
            match self.validate_capability(capability) {
                Ok(()) => result.approved.push(capability.clone()),
                Err(reason) => result.denied.push((capability.clone(), reason)),
            }
        }

        result
    }

    fn validate_capability(&self, cap: &PluginCapability) -> Result<(), String> {
        match cap {
            // Level 0-2: Generally allowed with policy check
            PluginCapability::UiRead
            | PluginCapability::DomainRead { .. }
            | PluginCapability::UiComponents { .. }
            | PluginCapability::MdxEdit { .. } => {
                if self.workspace_policy.allows_ui_plugins {
                    Ok(())
                } else {
                    Err("UI plugins disabled by workspace policy".into())
                }
            }

            // Level 3: Requires admin role
            PluginCapability::MembersManage { .. }
            | PluginCapability::DomainCreate { .. }
            | PluginCapability::DomainDelete { .. } => {
                if self.workspace_policy.admin_plugins_enabled {
                    Ok(())
                } else {
                    Err("Admin-level plugins require explicit enablement".into())
                }
            }

            // Level 4: Requires explicit allowlist
            PluginCapability::FsRead { paths, .. } => {
                for path in paths {
                    if !self.workspace_policy.allowed_fs_paths.iter().any(|p| path.starts_with(p)) {
                        return Err(format!("Path not in allowlist: {:?}", path));
                    }
                }
                Ok(())
            }

            PluginCapability::ProcessSpawn { allowlist } => {
                for entry in allowlist {
                    if !self.workspace_policy.allowed_executables.contains(&entry.executable) {
                        return Err(format!("Executable not allowed: {}", entry.executable));
                    }
                }
                Ok(())
            }

            PluginCapability::NetworkConnect { hosts, ports } => {
                for host in hosts {
                    if !self.workspace_policy.allowed_network_hosts.iter().any(|h| {
                        glob_match(h, host)
                    }) {
                        return Err(format!("Host not in allowlist: {}", host));
                    }
                }
                Ok(())
            }

            _ => Ok(())
        }
    }
}
```

### 10.3 Resource Limits

```rust
// Resource limiting for plugins
#[derive(Debug, Clone)]
pub struct PluginResourceLimits {
    /// Maximum CPU time per request (ms)
    pub cpu_time_ms: u64,

    /// Maximum memory (bytes)
    pub memory_bytes: u64,

    /// Maximum concurrent network connections
    pub max_connections: u32,

    /// Maximum filesystem operations per minute
    pub fs_ops_per_minute: u32,

    /// Maximum signal emissions per minute
    pub signals_per_minute: u32,
}

impl Default for PluginResourceLimits {
    fn default() -> Self {
        Self {
            cpu_time_ms: 5000,        // 5 seconds
            memory_bytes: 64 * 1024 * 1024,  // 64 MB
            max_connections: 10,
            fs_ops_per_minute: 1000,
            signals_per_minute: 100,
        }
    }
}

// Resource enforcement in WASM runtime
impl WasmPluginRuntime {
    pub async fn call_with_limits<T>(
        &mut self,
        func_name: &str,
        args: &[wasmtime::Val],
        limits: &PluginResourceLimits,
    ) -> Result<T, PluginError> {
        // Set fuel limit for CPU time
        self.store.set_fuel(limits.cpu_time_ms * FUEL_PER_MS)?;

        // Set memory limit
        let memory = self.instance.get_memory(&mut self.store, "memory")
            .ok_or(PluginError::NoMemory)?;
        // Note: Memory limiting requires WASM memory64 or custom allocator

        // Execute with timeout
        let result = tokio::time::timeout(
            Duration::from_millis(limits.cpu_time_ms),
            self.call_func(func_name, args)
        ).await??;

        Ok(result)
    }
}
```

### 10.4 Audit Logging

```rust
// Audit log for plugin actions
#[derive(Debug, Serialize)]
pub struct PluginAuditEntry {
    pub timestamp: i64,
    pub plugin_id: String,
    pub action: PluginAction,
    pub capability_used: PluginCapability,
    pub user_id: Option<String>,
    pub domain_path: Vec<String>,
    pub result: ActionResult,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub enum PluginAction {
    UiComponentRegistered { name: String },
    MdxContentModified { domain_id: String },
    SignalEmitted { signal_type: String },
    SignalPropagated { signal_type: String, direction: String },
    FileRead { path: String },
    FileWritten { path: String },
    ProcessSpawned { executable: String },
    NetworkConnected { host: String, port: u16 },
    MemberModified { user_id: String, action: String },
}

pub struct PluginAuditLog {
    entries: RwLock<VecDeque<PluginAuditEntry>>,
    max_entries: usize,
    persistent_log: Option<PathBuf>,
}

impl PluginAuditLog {
    pub async fn record(&self, entry: PluginAuditEntry) {
        // Add to in-memory buffer
        let mut entries = self.entries.write().await;
        entries.push_back(entry.clone());
        if entries.len() > self.max_entries {
            entries.pop_front();
        }

        // Persist if configured
        if let Some(ref path) = self.persistent_log {
            let line = serde_json::to_string(&entry).unwrap();
            tokio::fs::OpenOptions::new()
                .append(true)
                .create(true)
                .open(path)
                .await
                .unwrap()
                .write_all(format!("{}\n", line).as_bytes())
                .await
                .unwrap();
        }
    }

    pub async fn query(&self, filter: AuditFilter) -> Vec<PluginAuditEntry> {
        let entries = self.entries.read().await;
        entries.iter()
            .filter(|e| filter.matches(e))
            .cloned()
            .collect()
    }
}
```

---

## 11. Use Cases & Examples

### 11.1 In-Browser IDE

**Vision**: Transform a workspace room into a full-featured IDE with:
- Code editor with syntax highlighting
- File explorer connected to server filesystem
- Build system integration (compile, test, run)
- Terminal emulator with SSH
- Collaborative editing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  WORKSPACE: "Engineering"                                                    │
│  └── OFFICE: "Development"                                                   │
│      └── ROOM: "Project Alpha IDE"  [Plugins: IDE Suite]                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ┌─────────────┐  ┌────────────────────────────────────────────┐   │   │
│  │  │ File        │  │ Editor: main.rs                             │   │   │
│  │  │ Explorer    │  │ ─────────────────────────────────────────── │   │   │
│  │  │             │  │ 1 │ use std::collections::HashMap;          │   │   │
│  │  │ 📁 src      │  │ 2 │                                         │   │   │
│  │  │   📄 main.rs│  │ 3 │ fn main() {                             │   │   │
│  │  │   📄 lib.rs │  │ 4 │     println!("Hello, Citadel!");        │   │   │
│  │  │ 📁 tests    │  │ 5 │ }                                       │   │   │
│  │  │ 📄 Cargo.tom│  │                                             │   │   │
│  │  └─────────────┘  └────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │ Terminal (SSH: prod-server-01)                               │   │   │
│  │  │ $ cargo build --release                                      │   │   │
│  │  │    Compiling project-alpha v0.1.0                            │   │   │
│  │  │    Finished release [optimized] target(s) in 2.34s           │   │   │
│  │  │ $                                                            │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Plugins Required**:
```yaml
plugins:
  - id: "com.citadel.code-editor"
    capabilities: [ui:components, ui:panels, mdx:edit]

  - id: "com.citadel.file-explorer"
    capabilities: [fs:read, fs:write, ui:panels]
    config:
      root_path: "/projects/alpha"

  - id: "com.citadel.rust-compiler"
    capabilities: [fs:read, fs:write, process:spawn]
    config:
      toolchain: "stable"

  - id: "com.citadel.ssh-terminal"
    capabilities: [network:connect, ui:panels]
    config:
      allowed_hosts: ["10.0.0.0/8"]
```

### 11.2 Infrastructure Mirror (Server Room)

**Vision**: A workspace that mirrors physical/cloud infrastructure with:
- Real-time server status dashboards
- SSH access to servers
- Incident escalation system
- On-call rotation management

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  WORKSPACE: "Operations"                                                     │
│  └── OFFICE: "Server Room A"  [Plugins: Infrastructure Suite]               │
│      ├── ROOM: "Production Cluster"                                          │
│      ├── ROOM: "Database Servers"                                            │
│      └── ROOM: "Network Equipment"                                           │
│                                                                             │
│  SIGNAL FLOW (Incident Escalation):                                          │
│                                                                             │
│  1. Alert detected in "Database Servers" room                                │
│     └─► Signal: infrastructure.alert.critical                                │
│         └─► Payload: { server: "db-01", cpu: 95%, issue: "high load" }      │
│                                                                             │
│  2. Signal propagates UP to "Server Room A" office                           │
│     └─► Office admin receives notification                                   │
│     └─► Signal queued for review                                             │
│                                                                             │
│  3. Admin escalates to "Operations" workspace                                │
│     └─► On-call engineer notified via P2P message                           │
│     └─► Incident ticket created                                              │
│                                                                             │
│  4. Admin delegates fix to "Database Servers" room                           │
│     └─► Signal: incident.assigned                                            │
│     └─► Payload: { assignee: "dba-team", priority: "p1" }                   │
│                                                                             │
│  5. Resolution signal propagates UP                                          │
│     └─► Signal: incident.resolved                                            │
│     └─► Audit trail complete                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Plugins Required**:
```yaml
plugins:
  - id: "com.citadel.server-monitor"
    capabilities: [network:connect, ui:components, signals:emit]
    config:
      poll_interval: 30s
      alert_thresholds:
        cpu: 90
        memory: 85
        disk: 95

  - id: "com.citadel.incident-router"
    capabilities: [signals:subscribe, signals:propagate, messages:send]
    config:
      escalation_rules:
        - severity: critical
          action: immediate_escalate
        - severity: warning
          action: queue_for_review

  - id: "com.citadel.oncall-manager"
    capabilities: [members:read, signals:subscribe, ui:panels]
    config:
      schedule_source: "pagerduty"  # or internal
```

### 11.3 Project Management Hub

**Vision**: Workspace rooms as project boards with:
- Kanban/Scrum boards
- Sprint planning
- Time tracking
- Integration with GitHub/GitLab

```yaml
plugins:
  - id: "com.citadel.kanban-board"
    capabilities: [ui:components, mdx:edit, domain:write]

  - id: "com.citadel.github-integration"
    capabilities: [network:connect, signals:emit, ui:panels]
    config:
      repos: ["org/project-alpha", "org/project-beta"]

  - id: "com.citadel.sprint-planner"
    capabilities: [domain:write, members:read, signals:emit]

  - id: "com.citadel.time-tracker"
    capabilities: [domain:write, ui:panels]
```

### 11.4 Customer Support Center

**Vision**: Workspace as a support ticketing system with:
- Ticket queue management
- Customer chat integration
- Knowledge base (MDX content)
- SLA tracking

```yaml
plugins:
  - id: "com.citadel.ticket-queue"
    capabilities: [ui:panels, signals:subscribe, domain:write]

  - id: "com.citadel.customer-chat"
    capabilities: [messages:send, network:connect, ui:panels]

  - id: "com.citadel.knowledge-base"
    capabilities: [mdx:edit, ui:components]

  - id: "com.citadel.sla-monitor"
    capabilities: [signals:subscribe, signals:emit, ui:components]
```

---

## 12. Implementation Roadmap

### Phase 1: Foundation (Core Infrastructure)

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

### Phase 2: Interactivity (Level 1-2 Capabilities)

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

### Phase 3: Signal Propagation (Hierarchical Events)

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

### Phase 4: Backend Plugins (WASM Runtime)

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

### Phase 5: System Capabilities (Level 4)

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

### Phase 6: Ecosystem (Plugin Marketplace)

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

---

## 13. Plugin Marketplace

### 13.1 Marketplace Metadata Schema

Every plugin submitted to the marketplace must include comprehensive metadata for discovery, categorization, and security review.

```typescript
interface MarketplaceMetadata {
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════
  id: string;                     // Unique ID (e.g., "com.company.plugin-name")
  name: string;                   // Human-readable display name
  version: string;                // SemVer version (e.g., "2.1.0")

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLISHER INFO
  // ═══════════════════════════════════════════════════════════════════════════
  publisher: {
    id: string;                   // Publisher unique ID
    name: string;                 // Publisher display name
    verified: boolean;            // Has passed verification process
    website?: string;             // Publisher website URL
    support_email?: string;       // Support contact
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DESCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════
  description: string;            // Short description (max 200 chars)
  longDescription?: string;       // Full description (Markdown supported)
  changelog?: string;             // Version changelog (Markdown)

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIZATION
  // ═══════════════════════════════════════════════════════════════════════════
  category: PluginCategory;       // Primary category
  tags: string[];                 // Searchable tags (max 10)
  license: string;                // SPDX license identifier (e.g., "MIT", "proprietary")

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSETS
  // ═══════════════════════════════════════════════════════════════════════════
  icon: string;                   // URL to icon (256x256 PNG)
  banner?: string;                // URL to banner image (1200x400)
  screenshots?: string[];         // URLs to screenshots (max 5)
  documentation?: string;         // URL to documentation
  repository?: string;            // URL to source code (for open source)

  // ═══════════════════════════════════════════════════════════════════════════
  // PACKAGE TYPE & ARTIFACTS
  // ═══════════════════════════════════════════════════════════════════════════
  packageType: "typescript" | "wasm";

  artifacts: {
    frontend?: {
      bundle: string;             // URL to JS bundle
      types?: string;             // URL to .d.ts type definitions
      styles?: string;            // URL to CSS bundle
      integrity?: string;         // SRI hash for bundle verification
    };
    backend?: {
      bundle: string;             // URL to WASM binary
      runtime: "wasm";
      integrity?: string;         // SRI hash for WASM verification
    };
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUIREMENTS & CAPABILITIES
  // ═══════════════════════════════════════════════════════════════════════════
  capabilities: ScopedCapability[];
  capabilityJustifications?: Record<string, string>;  // Why each capability is needed
  dependencies?: PluginDependency[];
  citadelVersion: string;         // Minimum Citadel version required

  // ═══════════════════════════════════════════════════════════════════════════
  // MARKETPLACE STATS (populated by marketplace, not plugin author)
  // ═══════════════════════════════════════════════════════════════════════════
  stats?: {
    downloads: number;
    weeklyDownloads: number;
    rating: number;               // 1-5 stars
    reviewCount: number;
    firstPublished: string;       // ISO date
    lastUpdated: string;          // ISO date
  };
}

type PluginCategory =
  | "ide"               // Code editors, compilers, debuggers
  | "infrastructure"    // Server monitoring, DevOps tools
  | "workflow"          // Automation, bots, schedulers
  | "integration"       // Third-party service connectors
  | "ui"                // Themes, widgets, dashboards
  | "communication"     // Chat enhancements, notifications
  | "project"           // Project management, kanban, sprints
  | "security"          // Auth, audit, compliance
  | "analytics"         // Metrics, reporting, visualization
  | "other";            // Miscellaneous

interface PluginDependency {
  pluginId: string;               // Required plugin ID
  version: string;                // SemVer range (e.g., "^2.0.0")
  optional?: boolean;             // If true, enhances functionality but not required
}
```

### 13.2 Marketplace Categories

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PLUGIN MARKETPLACE CATEGORIES                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  💻 IDE                    │  Code editors, syntax highlighting, compilers,│
│                            │  debuggers, language servers, formatters      │
│                                                                             │
│  🖥️ Infrastructure         │  Server monitoring, SSH connectors, metrics,  │
│                            │  alerts, on-call management, dashboards       │
│                                                                             │
│  ⚙️ Workflow               │  Automation bots, scheduled tasks, approval   │
│                            │  flows, incident routing, notifications       │
│                                                                             │
│  🔗 Integration            │  GitHub, GitLab, Jira, Slack, AWS, GCP,       │
│                            │  database connectors, API bridges             │
│                                                                             │
│  🎨 UI                     │  Themes, custom widgets, dashboard panels,    │
│                            │  MDX components, layout extensions            │
│                                                                             │
│  💬 Communication          │  Chat enhancements, message formatting,       │
│                            │  translation, voice/video extensions          │
│                                                                             │
│  📋 Project                │  Kanban boards, sprint planning, time         │
│                            │  tracking, resource allocation, reports       │
│                                                                             │
│  🔒 Security               │  SSO integrations, audit logging, compliance, │
│                            │  encryption, access control extensions        │
│                                                                             │
│  📊 Analytics              │  Custom metrics, data visualization,          │
│                            │  reporting, BI integrations, exports          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 14. CitadelWorkspacePlugin Abstract Class

All plugins must implement the `CitadelWorkspacePlugin` interface. Two implementations are provided: TypeScript for open-source distribution and Rust for closed-source WASM compilation.

### 14.1 TypeScript Implementation (Open Source)

```typescript
/**
 * Abstract base class that all Citadel Workspace plugins must implement.
 *
 * Plugins can be implemented in TypeScript for open-source distribution
 * or compiled to WASM from Rust for closed-source distribution.
 *
 * @example
 * ```typescript
 * class MyPlugin extends CitadelWorkspacePlugin {
 *   readonly metadata = {
 *     id: "com.example.my-plugin",
 *     name: "My Plugin",
 *     version: "1.0.0"
 *   };
 *
 *   async init(context: PluginInitContext): Promise<void> {
 *     this.handle = context.handle;
 *     // Initialize plugin...
 *   }
 *
 *   async destroy(): Promise<void> {
 *     // Cleanup resources...
 *   }
 *
 *   healthCheck(): PluginHealth {
 *     return { status: "healthy" };
 *   }
 * }
 * ```
 */
export abstract class CitadelWorkspacePlugin {
  /**
   * Plugin metadata from manifest.
   * Must be defined by implementing class.
   */
  abstract readonly metadata: PluginMetadata;

  /**
   * Plugin handle provided by host.
   * Set during init() via context.handle.
   */
  protected handle!: PluginHandle;

  /**
   * Initialize the plugin with the granted capabilities.
   * Called once when plugin is loaded into workspace.
   *
   * @param context - Initialization context with handle and config
   * @throws PluginError if initialization fails
   */
  abstract init(context: PluginInitContext): Promise<void>;

  /**
   * Clean up resources when plugin is unloaded.
   * Must release all handles, subscriptions, and timers.
   */
  abstract destroy(): Promise<void>;

  /**
   * Health check - return current plugin status.
   * Called periodically by the plugin host.
   */
  abstract healthCheck(): PluginHealth;

  // ═══════════════════════════════════════════════════════════════════════════
  // OPTIONAL LIFECYCLE HOOKS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Called when the plugin is activated (user enters plugin's domain).
   * Use for lazy initialization of resources.
   */
  onActivate?(): Promise<void>;

  /**
   * Called when the plugin is deactivated (user leaves plugin's domain).
   * Use to pause expensive operations.
   */
  onDeactivate?(): Promise<void>;

  /**
   * Called when plugin configuration changes.
   * Allows dynamic reconfiguration without full reload.
   */
  onConfigChange?(config: Record<string, unknown>): Promise<void>;

  /**
   * Called when a signal is received in this plugin's subscribed patterns.
   * Override to handle signals reactively.
   */
  onSignal?(signal: Signal): Promise<void>;
}

interface PluginMetadata {
  id: string;
  name: string;
  version: string;
}

interface PluginInitContext {
  /** Granted capabilities (may be subset of requested) */
  grantedCapabilities: ScopedCapability[];

  /** Plugin configuration provided by admin */
  config: Record<string, unknown>;

  /** Domain context where plugin is installed */
  domain: {
    type: "workspace" | "office" | "room";
    id: string;
    path: string[];  // Full path from workspace root
  };

  /** The plugin handle (API surface) */
  handle: PluginHandle;
}

interface PluginHealth {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  lastCheck?: number;
  metrics?: Record<string, number>;
}
```

### 14.2 Rust Implementation (Closed Source WASM)

```rust
//! Abstract trait that all Citadel Workspace plugins must implement.
//!
//! Compile to WASM for closed-source distribution using:
//! ```bash
//! cargo build --target wasm32-unknown-unknown --release
//! ```

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Core trait that all Citadel Workspace plugins must implement.
///
/// # Example
///
/// ```rust
/// use citadel_plugin_sdk::prelude::*;
///
/// pub struct MyPlugin {
///     handle: Option<PluginHandle>,
///     config: serde_json::Value,
/// }
///
/// #[async_trait]
/// impl CitadelWorkspacePlugin for MyPlugin {
///     fn metadata(&self) -> &PluginMetadata {
///         &PluginMetadata {
///             id: "com.example.my-plugin".into(),
///             name: "My Plugin".into(),
///             version: "1.0.0".into(),
///         }
///     }
///
///     async fn init(&mut self, ctx: PluginInitContext) -> Result<(), PluginError> {
///         self.handle = Some(ctx.handle);
///         self.config = ctx.config;
///         Ok(())
///     }
///
///     async fn destroy(&mut self) -> Result<(), PluginError> {
///         self.handle = None;
///         Ok(())
///     }
///
///     fn health_check(&self) -> PluginHealth {
///         PluginHealth::healthy()
///     }
/// }
/// ```
#[async_trait]
pub trait CitadelWorkspacePlugin: Send + Sync {
    /// Plugin metadata (id, name, version)
    fn metadata(&self) -> &PluginMetadata;

    /// Initialize the plugin with granted capabilities.
    ///
    /// Called once when plugin is loaded. Store the handle for later use.
    async fn init(&mut self, context: PluginInitContext) -> Result<(), PluginError>;

    /// Clean up resources when plugin is unloaded.
    ///
    /// Must release all handles, subscriptions, and timers.
    async fn destroy(&mut self) -> Result<(), PluginError>;

    /// Health check - return current plugin status.
    ///
    /// Called periodically by the plugin host.
    fn health_check(&self) -> PluginHealth;

    // ═══════════════════════════════════════════════════════════════════════════
    // OPTIONAL LIFECYCLE HOOKS (default implementations provided)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Called when the plugin is activated (user enters plugin's domain).
    async fn on_activate(&mut self) -> Result<(), PluginError> {
        Ok(())
    }

    /// Called when the plugin is deactivated (user leaves plugin's domain).
    async fn on_deactivate(&mut self) -> Result<(), PluginError> {
        Ok(())
    }

    /// Called when plugin configuration changes.
    async fn on_config_change(
        &mut self,
        _config: serde_json::Value,
    ) -> Result<(), PluginError> {
        Ok(())
    }

    /// Called when a signal is received in subscribed patterns.
    async fn on_signal(&mut self, _signal: Signal) -> Result<(), PluginError> {
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone)]
pub struct PluginInitContext {
    pub granted_capabilities: Vec<ScopedCapability>,
    pub config: serde_json::Value,
    pub domain: DomainContext,
    pub handle: PluginHandle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainContext {
    pub domain_type: DomainType,
    pub id: String,
    pub path: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DomainType {
    Workspace,
    Office,
    Room,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginHealth {
    pub status: HealthStatus,
    pub message: Option<String>,
    pub last_check: Option<i64>,
    pub metrics: Option<std::collections::HashMap<String, f64>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

impl PluginHealth {
    pub fn healthy() -> Self {
        Self {
            status: HealthStatus::Healthy,
            message: None,
            last_check: Some(chrono::Utc::now().timestamp()),
            metrics: None,
        }
    }

    pub fn degraded(message: impl Into<String>) -> Self {
        Self {
            status: HealthStatus::Degraded,
            message: Some(message.into()),
            last_check: Some(chrono::Utc::now().timestamp()),
            metrics: None,
        }
    }

    pub fn unhealthy(message: impl Into<String>) -> Self {
        Self {
            status: HealthStatus::Unhealthy,
            message: Some(message.into()),
            last_check: Some(chrono::Utc::now().timestamp()),
            metrics: None,
        }
    }
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum PluginError {
    #[error("Initialization failed: {0}")]
    InitFailed(String),

    #[error("Capability not granted: {0}")]
    CapabilityDenied(String),

    #[error("Handle operation failed: {0}")]
    HandleError(String),

    #[error("Internal error: {0}")]
    Internal(String),
}
```

---

## 15. Plugin Packaging Formats

Citadel supports two plugin packaging formats to accommodate different development and distribution models.

### 15.1 TypeScript Package (Open Source)

TypeScript packages allow community inspection, contribution, and trust through transparency.

```
my-plugin/
├── package.json              # npm package metadata
├── citadel.manifest.json     # Citadel-specific metadata & capabilities
├── dist/
│   ├── index.js              # Bundled plugin code (ES modules)
│   ├── index.js.map          # Source maps for debugging
│   ├── index.d.ts            # TypeScript type definitions
│   └── styles.css            # Optional plugin styles
├── src/
│   ├── index.ts              # Entry point (exports CitadelWorkspacePlugin)
│   ├── components/           # React components
│   └── utils/                # Helper utilities
├── tests/
│   └── plugin.test.ts        # Plugin tests
├── README.md                 # Documentation
├── CHANGELOG.md              # Version history
└── LICENSE                   # License file
```

**citadel.manifest.json:**
```json
{
  "$schema": "https://citadel.dev/schemas/plugin-manifest.json",
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A sample Citadel workspace plugin",
  "publisher": {
    "id": "example",
    "name": "Example Corp"
  },
  "category": "ui",
  "tags": ["widget", "dashboard", "example"],
  "license": "MIT",
  "citadelVersion": ">=1.0.0",
  "capabilities": [
    { "type": "ui:components", "scope": { "component_names": ["MyWidget"] } },
    { "type": "signals:subscribe", "scope": { "patterns": ["workspace.*"] } }
  ],
  "capabilityJustifications": {
    "ui:components": "Register the MyWidget component for use in MDX",
    "signals:subscribe": "Listen to workspace events for real-time updates"
  },
  "artifacts": {
    "frontend": {
      "bundle": "./dist/index.js",
      "types": "./dist/index.d.ts",
      "styles": "./dist/styles.css"
    }
  }
}
```

### 15.2 WASM Binary (Closed Source)

WASM packages allow proprietary distribution while maintaining security through sandboxing.

```
my-plugin/
├── citadel.manifest.json     # Citadel-specific metadata & capabilities
├── plugin.wasm               # Compiled WASM binary
├── frontend/                 # Optional frontend bundle (if plugin has UI)
│   ├── bundle.js             # UI components
│   ├── bundle.js.map         # Source maps
│   └── styles.css            # Styles
├── README.md                 # Documentation
├── CHANGELOG.md              # Version history
└── LICENSE                   # License file (may be proprietary)
```

**Build process for Rust → WASM:**
```bash
# Install wasm-pack
cargo install wasm-pack

# Build the plugin
wasm-pack build --target web --release

# Output structure:
# pkg/
#   ├── plugin.wasm
#   ├── plugin.js        # JS bindings
#   └── plugin.d.ts      # TypeScript types
```

### 15.3 Manifest Comparison

| Field | TypeScript | WASM | Notes |
|-------|------------|------|-------|
| `packageType` | `"typescript"` | `"wasm"` | Required |
| `artifacts.frontend.bundle` | JS file path | JS file path | Optional for backend-only |
| `artifacts.backend.bundle` | N/A | WASM file path | Required for backend plugins |
| `repository` | Often provided | Often omitted | Open source indicator |
| Source inspection | Full source available | Binary only | Trust model differs |

---

## 16. Admin & User UX Flows

### 16.1 Admin: Plugin Installation Flow

When a workspace admin installs a plugin, they see a detailed permission review:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INSTALL PLUGIN: "Server Monitor Pro"                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  📦  com.citadel-labs.server-monitor-pro                            │   │
│  │                                                                      │   │
│  │  Publisher: Citadel Labs (✓ Verified)                               │   │
│  │  Version: 2.1.0                                                      │   │
│  │  Category: Infrastructure                                            │   │
│  │  License: Commercial                                                 │   │
│  │  Downloads: 12,345  ⭐ 4.8 (234 reviews)                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  REQUIRED PERMISSIONS                                                │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │  ⚠️  This plugin requires the following capabilities:                 │   │
│  │                                                                       │   │
│  │  ┌──────────────────────┬──────────────┬─────────────────────────┐  │   │
│  │  │ Permission           │ Level        │ Justification           │  │   │
│  │  ├──────────────────────┼──────────────┼─────────────────────────┤  │   │
│  │  │ ui:panels            │ ◐ Interact   │ Display monitoring panel│  │   │
│  │  │ ui:components        │ ◐ Interact   │ ServerStatus widget     │  │   │
│  │  │ signals:emit         │ ◐ Interact   │ Emit server alerts      │  │   │
│  │  │ signals:propagate    │ ◑ Modify     │ Escalate incidents      │  │   │
│  │  │ network:connect      │ ● System     │ Connect to servers      │  │   │
│  │  │   → 10.0.0.0/8:22    │              │   (SSH monitoring)      │  │   │
│  │  │   → 10.0.0.0/8:443   │              │   (HTTPS metrics)       │  │   │
│  │  └──────────────────────┴──────────────┴─────────────────────────┘  │   │
│  │                                                                       │   │
│  │  Level Legend: ○ Observe  ◐ Interact  ◑ Modify  ◕ Manage  ● System  │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ✓ All requested capabilities are within workspace policy           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [ View Source ]  [ View Reviews ]  [ Cancel ]  [ ✓ Approve & Install ]    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 16.2 User: First-Join Security/Privacy Modal

When a user first joins a workspace with plugins installed:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🛡️  WORKSPACE SECURITY & PRIVACY                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  You're joining "Engineering" workspace.                                    │
│  This workspace has 3 plugins that request the following permissions.       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  PERMISSION SUMMARY                                                  │   │
│  ├───────────────────────┬──────────┬───────────────────────────────────┤   │
│  │ Permission            │ Required │ Source                            │   │
│  ├───────────────────────┼──────────┼───────────────────────────────────┤   │
│  │ Read workspace data   │    ✓     │ All plugins                       │   │
│  │ Display UI panels     │    ✓     │ Server Monitor, IDE               │   │
│  │ Register MDX          │    ✓     │ IDE, Kanban Board                 │   │
│  │   components          │          │                                   │   │
│  │ Emit signals          │    ✓     │ Server Monitor, Incident Router   │   │
│  │ Propagate signals     │    ✓     │ Incident Router                   │   │
│  │ Send P2P messages     │    ✓     │ Incident Router                   │   │
│  │ Edit MDX content      │    ✓     │ IDE                               │   │
│  │ Read filesystem       │    ⚠️     │ IDE                               │   │
│  │   /projects/*         │          │   (scoped to project files)       │   │
│  │ Write filesystem      │    ⚠️     │ IDE                               │   │
│  │   /projects/*         │          │   (scoped to project files)       │   │
│  │ Spawn processes       │    ⚠️     │ IDE                               │   │
│  │   cargo, npm, node    │          │   (build tools only)              │   │
│  │ Network connections   │    ⚠️     │ Server Monitor                    │   │
│  │   10.0.0.0/8          │          │   (internal network only)         │   │
│  └───────────────────────┴──────────┴───────────────────────────────────┘   │
│                                                                             │
│  Legend:  ✓ = Standard permission    ⚠️ = Elevated (Level 4) permission     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  🔒 Your data is protected:                                          │   │
│  │  • Plugins cannot access your credentials or private messages        │   │
│  │  • All plugin actions are logged and auditable                       │   │
│  │  • You can revoke plugin access at any time in Settings              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [ View Plugin Details ]    [ Leave Workspace ]    [ ✓ Accept & Continue ] │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 16.3 Admin: Policy Violation on Install

When a secondary admin (with `ManagePlugins` but not `ConfigurePluginPolicy`) tries to install a plugin that exceeds the workspace policy:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⚠️  INSTALLATION BLOCKED                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  "Server Monitor Pro" cannot be installed due to workspace policy           │
│  restrictions.                                                              │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  POLICY VIOLATIONS                                                   │   │
│  ├───────────────────────┬───────────────────┬─────────────────────────┤   │
│  │ Requested             │ Policy Allows     │ Status                  │   │
│  ├───────────────────────┼───────────────────┼─────────────────────────┤   │
│  │ network: 0.0.0.0/0    │ 10.0.0.0/8 only   │ ❌ Scope too broad      │   │
│  │ fs:write: /           │ /projects, /tmp   │ ❌ Path not allowed     │   │
│  │ process: any          │ cargo, npm, node  │ ❌ Scope required       │   │
│  └───────────────────────┴───────────────────┴─────────────────────────┘   │
│                                                                             │
│  Contact the workspace owner to either:                                     │
│  • Update the workspace plugin policy                                       │
│  • Request a custom-scoped version of this plugin                          │
│  • Add this plugin to the workspace whitelist                              │
│                                                                             │
│  [ View Full Policy ]    [ Request Policy Change ]    [ Close ]            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 16.4 Permission Aggregation Logic

```typescript
interface AggregatedPermission {
  permission: ScopedCapability;
  required: boolean;
  level: PermissionLevel;      // 0-4
  sources: PluginSource[];     // Which plugins require this
  scope?: string;              // Human-readable scope (e.g., "/projects/*")
  justification?: string;      // Combined justifications
}

interface PluginSource {
  pluginId: string;
  pluginName: string;
  icon?: string;
}

/**
 * Aggregate permissions from multiple plugins for display.
 * Groups similar permissions and tracks which plugins require each.
 */
function aggregatePermissions(plugins: InstalledPlugin[]): AggregatedPermission[] {
  const permMap = new Map<string, AggregatedPermission>();

  for (const plugin of plugins) {
    for (const cap of plugin.capabilities) {
      const key = getCapabilityKey(cap);  // Normalize for grouping

      if (permMap.has(key)) {
        // Add to existing sources
        const existing = permMap.get(key)!;
        existing.sources.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          icon: plugin.icon
        });
      } else {
        // New permission entry
        permMap.set(key, {
          permission: cap,
          required: true,
          level: getCapabilityLevel(cap),
          sources: [{
            pluginId: plugin.id,
            pluginName: plugin.name,
            icon: plugin.icon
          }],
          scope: formatScope(cap.scope),
          justification: plugin.manifest.capabilityJustifications?.[key]
        });
      }
    }
  }

  // Sort by level (highest first) then alphabetically
  return Array.from(permMap.values())
    .sort((a, b) => b.level - a.level || a.permission.type.localeCompare(b.permission.type));
}

function formatScope(scope: CapabilityScope | undefined): string | undefined {
  if (!scope) return undefined;

  if ('ip_addresses' in scope) {
    return scope.ip_addresses.join(', ');
  }
  if ('paths' in scope) {
    return scope.paths.join(', ');
  }
  if ('executables' in scope) {
    return scope.executables.join(', ');
  }
  return undefined;
}
```

---

## 17. Scoped Capabilities

Capabilities can be **scoped** for fine-grained security. Unscoped capabilities grant broad access; scoped capabilities are restricted to specific resources.

### 17.1 Scoped Capability Types

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// NETWORK CAPABILITY
// ═══════════════════════════════════════════════════════════════════════════
interface NetworkCapability {
  type: "network";
  scope?: {
    ip_addresses: string[];      // CIDR notation: ["10.0.0.0/8", "192.168.1.0/24"]
    ports?: number[];            // Specific ports: [22, 443, 8080]
    protocols?: ("tcp" | "udp" | "tls")[];
  };
}
// Unscoped: Can connect to any host/port
// Scoped: Can only connect to specified IP ranges and ports

// ═══════════════════════════════════════════════════════════════════════════
// FILESYSTEM CAPABILITY
// ═══════════════════════════════════════════════════════════════════════════
interface FilesystemCapability {
  type: "fs:read" | "fs:write";
  scope?: {
    paths: string[];             // Glob patterns: ["/projects/*", "/tmp/plugin-*"]
    recursive?: boolean;         // Allow subdirectory access
  };
}
// Unscoped: Can access any filesystem path
// Scoped: Can only access specified paths

// ═══════════════════════════════════════════════════════════════════════════
// UI INJECTION CAPABILITY
// ═══════════════════════════════════════════════════════════════════════════
interface UiInjectCapability {
  type: "ui:inject";
  scope?: {
    selectors: string[];         // CSS selectors: [".plugin-zone-*", "#extension-panel"]
    allowed_tags?: string[];     // HTML tags: ["div", "span", "button"]
  };
}
// Unscoped: Can inject into any DOM element
// Scoped: Can only inject into specified selectors with specified tags

// ═══════════════════════════════════════════════════════════════════════════
// PROCESS SPAWN CAPABILITY
// ═══════════════════════════════════════════════════════════════════════════
interface ProcessSpawnCapability {
  type: "process:spawn";
  scope?: {
    executables: string[];       // Allowed binaries: ["cargo", "npm", "node"]
    args_patterns?: string[];    // Regex for allowed arguments
    env_allowlist?: string[];    // Allowed environment variables
  };
}
// Unscoped: Can spawn any process
// Scoped: Can only spawn specified executables with restricted args/env

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL CAPABILITY
// ═══════════════════════════════════════════════════════════════════════════
interface SignalCapability {
  type: "signals:subscribe" | "signals:emit" | "signals:propagate";
  scope?: {
    patterns: string[];          // Signal patterns: ["infrastructure.*", "build.*"]
  };
}
// Unscoped: Can interact with all signals
// Scoped: Can only interact with matching signal patterns
```

### 17.2 Capability → Permission Mapping

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// UNSCOPED CAPABILITY → BROAD PERMISSION
// ═══════════════════════════════════════════════════════════════════════════

// Plugin manifest:
{
  "capabilities": [
    { "type": "network" }  // No scope = any network access
  ]
}

// Maps to Permission:
{
  "type": "network",
  "scope": null  // No restrictions - DANGEROUS
}

// ═══════════════════════════════════════════════════════════════════════════
// SCOPED CAPABILITY → RESTRICTED PERMISSION
// ═══════════════════════════════════════════════════════════════════════════

// Plugin manifest:
{
  "capabilities": [
    {
      "type": "network",
      "scope": {
        "ip_addresses": ["10.0.0.0/8"],
        "ports": [22, 443]
      }
    }
  ]
}

// Maps to Permission:
{
  "type": "network",
  "scope": {
    "ip_addresses": ["10.0.0.0/8"],
    "ports": [22, 443]
  }
}
// Plugin can ONLY connect to 10.x.x.x addresses on ports 22 or 443
```

### 17.3 Scope Enforcement at Runtime

```rust
impl PluginHandle {
    /// Make a network connection (scope-enforced)
    pub async fn connect(&self, host: &str, port: u16) -> Result<Connection, PluginError> {
        // Check against granted scope
        if let Some(ref scope) = self.network_scope {
            // Validate IP is in allowed ranges
            let ip = resolve_host(host).await?;
            if !scope.ip_addresses.iter().any(|cidr| cidr.contains(ip)) {
                return Err(PluginError::CapabilityDenied(
                    format!("Host {} ({}) not in allowed IP ranges", host, ip)
                ));
            }

            // Validate port is allowed
            if let Some(ref ports) = scope.ports {
                if !ports.contains(&port) {
                    return Err(PluginError::CapabilityDenied(
                        format!("Port {} not in allowed ports", port)
                    ));
                }
            }
        } else {
            // No network capability at all
            return Err(PluginError::CapabilityDenied(
                "Network capability not granted".into()
            ));
        }

        // Scope validated - proceed with connection
        self.runtime.connect(host, port).await
    }
}
```

---

## 18. Workspace Permission Policy

Workspace owners can define what plugin capabilities are allowed through a **permission policy**. This policy is stored in workspace metadata and enforced at plugin installation time.

### 18.1 Policy Configuration Schema

```json
{
  "id": "workspace-123",
  "name": "Engineering",
  "plugin_policy": {
    "enabled": true,
    "max_permission_level": 4,

    "allowed_capabilities": {
      "ui:read": { "enabled": true },
      "ui:components": { "enabled": true },
      "ui:panels": { "enabled": true },
      "ui:inject": {
        "enabled": true,
        "scope_required": true,
        "allowed_selectors": [".plugin-zone-*", "#extension-panel"]
      },
      "mdx:edit": { "enabled": true },
      "signals:emit": { "enabled": true },
      "signals:propagate": { "enabled": true },
      "signals:broadcast": { "enabled": false },
      "network": {
        "enabled": true,
        "scope_required": true,
        "allowed_ip_ranges": ["10.0.0.0/8", "192.168.0.0/16"],
        "denied_ip_ranges": ["0.0.0.0/0"],
        "allowed_ports": [22, 80, 443, 8080, 8443]
      },
      "fs:read": {
        "enabled": true,
        "scope_required": true,
        "allowed_paths": ["/projects", "/shared", "/tmp"]
      },
      "fs:write": {
        "enabled": true,
        "scope_required": true,
        "allowed_paths": ["/projects", "/tmp"]
      },
      "process:spawn": {
        "enabled": true,
        "scope_required": true,
        "allowed_executables": ["cargo", "npm", "node", "python3", "git"]
      }
    },

    "blocked_publishers": ["untrusted-corp"],
    "trusted_publishers": ["citadel-labs", "company-internal"],
    "require_source_available": false,

    "plugin_blacklist": [
      "com.untrusted.malicious-plugin",
      "com.deprecated.old-plugin"
    ],

    "plugin_whitelist": [
      {
        "plugin_id": "com.company.internal-ide",
        "reason": "Internal tool - pre-approved by security team",
        "approved_by": "security@company.com",
        "approved_at": "2024-01-15T10:30:00Z"
      },
      {
        "plugin_id": "com.citadel-labs.enterprise-monitor",
        "reason": "Enterprise license includes elevated permissions",
        "approved_by": "admin@company.com",
        "approved_at": "2024-02-01T14:00:00Z"
      }
    ]
  }
}
```

### 18.2 New Domain Permissions

Add to the existing `Permission` enum:

```rust
pub enum Permission {
    // ... existing permissions ...

    /// Can install, uninstall, and configure plugins.
    /// Subject to workspace plugin_policy restrictions.
    ManagePlugins,

    /// Can modify workspace plugin_policy.
    /// Typically reserved for workspace owner.
    ConfigurePluginPolicy,
}

impl Permission {
    pub fn for_role(role: &UserRole) -> HashSet<Self> {
        let mut permissions = HashSet::new();

        match role {
            UserRole::Owner => {
                // Owners get both plugin permissions
                permissions.insert(Self::ManagePlugins);
                permissions.insert(Self::ConfigurePluginPolicy);
            }
            UserRole::Admin => {
                // Admins can manage plugins but NOT change policy
                permissions.insert(Self::ManagePlugins);
                // ConfigurePluginPolicy NOT granted
            }
            UserRole::Member | UserRole::Guest => {
                // Members and guests cannot manage plugins
            }
            UserRole::Custom(_, rank) => {
                // Custom roles: ManagePlugins if rank >= 8 (out of 10)
                if *rank >= 8 {
                    permissions.insert(Self::ManagePlugins);
                }
            }
        }

        permissions
    }
}
```

### 18.3 Policy Validation Pipeline

```rust
pub struct PluginPolicyValidator {
    workspace_policy: PluginPolicy,
}

impl PluginPolicyValidator {
    pub fn validate_installation(
        &self,
        manifest: &PluginManifest,
        installer: &User,
    ) -> Result<ValidationResult, PolicyViolation> {
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Check if plugins are enabled
        // ═══════════════════════════════════════════════════════════════════
        if !self.workspace_policy.enabled {
            return Err(PolicyViolation::PluginsDisabled);
        }

        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Check installer permissions
        // ═══════════════════════════════════════════════════════════════════
        if !installer.has_permission(Permission::ManagePlugins) {
            return Err(PolicyViolation::InsufficientPermissions);
        }

        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: BLACKLIST CHECK (highest priority - always blocked)
        // ═══════════════════════════════════════════════════════════════════
        if self.workspace_policy.plugin_blacklist.contains(&manifest.id) {
            return Err(PolicyViolation::PluginBlacklisted(manifest.id.clone()));
        }

        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: WHITELIST CHECK (supersedes all other policy checks)
        // ═══════════════════════════════════════════════════════════════════
        if let Some(entry) = self.find_whitelist_entry(&manifest.id) {
            return Ok(ValidationResult::WhitelistApproved {
                reason: entry.reason.clone(),
                approved_by: entry.approved_by.clone(),
                approved_at: entry.approved_at,
            });
        }

        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Check publisher trust
        // ═══════════════════════════════════════════════════════════════════
        if self.workspace_policy.blocked_publishers.contains(&manifest.publisher.id) {
            return Err(PolicyViolation::PublisherBlocked(manifest.publisher.id.clone()));
        }

        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Validate each capability against policy
        // ═══════════════════════════════════════════════════════════════════
        for cap in &manifest.capabilities {
            self.validate_capability(cap)?;
        }

        Ok(ValidationResult::PolicyCompliant)
    }

    fn find_whitelist_entry(&self, plugin_id: &str) -> Option<&WhitelistEntry> {
        self.workspace_policy.plugin_whitelist
            .iter()
            .find(|e| e.plugin_id == plugin_id)
    }

    fn validate_capability(&self, cap: &ScopedCapability) -> Result<(), PolicyViolation> {
        let policy = match self.workspace_policy.allowed_capabilities.get(&cap.type_name()) {
            Some(p) => p,
            None => return Err(PolicyViolation::CapabilityNotAllowed(cap.type_name())),
        };

        if !policy.enabled {
            return Err(PolicyViolation::CapabilityDisabled(cap.type_name()));
        }

        // Check if scope is required but not provided
        if policy.scope_required && cap.scope.is_none() {
            return Err(PolicyViolation::ScopeRequired(cap.type_name()));
        }

        // Validate scope against policy limits
        if let Some(ref scope) = cap.scope {
            self.validate_scope(&cap.type_name(), scope, policy)?;
        }

        Ok(())
    }

    fn validate_scope(
        &self,
        cap_type: &str,
        scope: &CapabilityScope,
        policy: &CapabilityPolicy,
    ) -> Result<(), PolicyViolation> {
        match cap_type {
            "network" => self.validate_network_scope(scope, policy),
            "fs:read" | "fs:write" => self.validate_fs_scope(scope, policy),
            "process:spawn" => self.validate_process_scope(scope, policy),
            "ui:inject" => self.validate_ui_inject_scope(scope, policy),
            _ => Ok(()),
        }
    }

    fn validate_network_scope(
        &self,
        scope: &CapabilityScope,
        policy: &CapabilityPolicy,
    ) -> Result<(), PolicyViolation> {
        let CapabilityScope::Network { ip_addresses, ports, .. } = scope else {
            return Ok(());
        };

        // Check each IP against allowed/denied ranges
        for ip in ip_addresses {
            if !self.ip_in_ranges(ip, &policy.allowed_ip_ranges) {
                return Err(PolicyViolation::IpNotAllowed(ip.clone()));
            }
            if self.ip_in_ranges(ip, &policy.denied_ip_ranges) {
                return Err(PolicyViolation::IpDenied(ip.clone()));
            }
        }

        // Check ports
        if let (Some(requested_ports), Some(allowed_ports)) = (ports, &policy.allowed_ports) {
            for port in requested_ports {
                if !allowed_ports.contains(port) {
                    return Err(PolicyViolation::PortNotAllowed(*port));
                }
            }
        }

        Ok(())
    }
}

/// Result of successful policy validation
#[derive(Debug, Clone)]
pub enum ValidationResult {
    /// Plugin complies with all workspace policies
    PolicyCompliant,
    /// Plugin is explicitly whitelisted - bypassed policy checks
    WhitelistApproved {
        reason: String,
        approved_by: String,
        approved_at: chrono::DateTime<chrono::Utc>,
    },
}

/// Whitelist entry stored in workspace policy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhitelistEntry {
    pub plugin_id: String,
    pub reason: String,
    pub approved_by: String,
    pub approved_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum PolicyViolation {
    #[error("Plugins are disabled for this workspace")]
    PluginsDisabled,

    #[error("User does not have ManagePlugins permission")]
    InsufficientPermissions,

    #[error("Plugin {0} is blacklisted")]
    PluginBlacklisted(String),

    #[error("Publisher {0} is blocked")]
    PublisherBlocked(String),

    #[error("Capability {0} is not allowed by policy")]
    CapabilityNotAllowed(String),

    #[error("Capability {0} is disabled")]
    CapabilityDisabled(String),

    #[error("Capability {0} requires a scope but none provided")]
    ScopeRequired(String),

    #[error("IP range {0} is not in allowed list")]
    IpNotAllowed(String),

    #[error("IP range {0} is explicitly denied")]
    IpDenied(String),

    #[error("Port {0} is not in allowed list")]
    PortNotAllowed(u16),

    #[error("Path {0} is not in allowed list")]
    PathNotAllowed(String),

    #[error("Executable {0} is not in allowed list")]
    ExecutableNotAllowed(String),

    #[error("Selector {0} is not in allowed list")]
    SelectorNotAllowed(String),
}
```

### 18.4 Validation Precedence Order

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PLUGIN INSTALLATION VALIDATION PIPELINE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. BLACKLIST CHECK (Highest Priority)                                       │
│     │                                                                        │
│     ├── Plugin ID in blacklist? ──► BLOCKED (always)                        │
│     │                                                                        │
│     ▼                                                                        │
│  2. WHITELIST CHECK (Supersedes Policy)                                      │
│     │                                                                        │
│     ├── Plugin ID in whitelist? ──► APPROVED (bypass all other checks)      │
│     │                                                                        │
│     ▼                                                                        │
│  3. PUBLISHER TRUST CHECK                                                    │
│     │                                                                        │
│     ├── Publisher in blocked list? ──► BLOCKED                              │
│     │                                                                        │
│     ▼                                                                        │
│  4. CAPABILITY POLICY VALIDATION                                             │
│     │                                                                        │
│     ├── For each capability:                                                 │
│     │   ├── Capability type allowed? ──► NO: BLOCKED                        │
│     │   ├── Capability enabled? ──► NO: BLOCKED                             │
│     │   ├── Scope required but missing? ──► BLOCKED                         │
│     │   └── Scope within policy limits? ──► NO: BLOCKED                     │
│     │                                                                        │
│     ▼                                                                        │
│  5. APPROVED (Policy Compliant)                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix A: Signal Type Registry

Standard signal types that plugins should use for interoperability:

```yaml
# Infrastructure
infrastructure.alert.critical
infrastructure.alert.warning
infrastructure.alert.info
infrastructure.status.healthy
infrastructure.status.degraded
infrastructure.status.down

# Incidents
incident.created
incident.assigned
incident.escalated
incident.resolved
incident.closed

# Build/Deploy
build.started
build.succeeded
build.failed
deploy.started
deploy.succeeded
deploy.failed
deploy.rollback

# Workspace
workspace.member.joined
workspace.member.left
workspace.content.updated
workspace.settings.changed

# Plugin
plugin.installed
plugin.uninstalled
plugin.error
plugin.health.degraded
```

---

## Appendix B: MDX Component Convention

Plugins should follow these conventions for MDX components:

```typescript
// Component naming: PascalCase, namespaced
// Good: "MyPlugin.StatusWidget"
// Bad: "status-widget", "statusWidget"

// Props should be documented
interface StatusWidgetProps {
  /** Server ID to display status for */
  serverId: string;
  /** Refresh interval in seconds */
  refreshInterval?: number;
  /** Show detailed metrics */
  detailed?: boolean;
}

// Components should handle loading/error states
function StatusWidget({ serverId, refreshInterval = 30 }: StatusWidgetProps) {
  const { data, loading, error } = useServerStatus(serverId, refreshInterval);

  if (loading) return <Skeleton />;
  if (error) return <Alert variant="error">{error.message}</Alert>;

  return <StatusDisplay status={data} />;
}
```

---

## Appendix C: Security Checklist for Plugin Developers

Before publishing a plugin:

- [ ] Request only capabilities actually needed
- [ ] Handle all errors gracefully (no crashes)
- [ ] Sanitize user input before rendering
- [ ] Don't store sensitive data in plugin storage
- [ ] Use capability-scoped paths for filesystem access
- [ ] Validate network responses before processing
- [ ] Implement proper cleanup in shutdown handler
- [ ] Test with resource limits enabled
- [ ] Document all capabilities and why they're needed
- [ ] Provide clear privacy policy if collecting data

---

## Appendix D: Glossary

| Term | Definition |
|------|------------|
| **Capability** | A permission granted to a plugin to access specific functionality |
| **Domain** | A workspace, office, or room in the hierarchy |
| **Signal** | An event that can propagate through the domain hierarchy |
| **Handle** | The API surface exposed to plugins for accessing workspace functionality |
| **Hook** | A callback that plugins register to intercept workspace operations |
| **Manifest** | The JSON file describing a plugin's metadata and capability requirements |
| **Propagation** | The process of sending a signal up, down, or across the domain hierarchy |

---

*This specification is a living document. As implementation progresses, details will be refined and expanded based on real-world usage and feedback.*
