# Permission Model

## Capability Categories

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

## Capability Definition

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

## Permission Inheritance

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
