# Plugin Lifecycle

## Lifecycle Phases

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ DISCOVER │ → │ INSTALL  │ → │  INIT    │ → │  ACTIVE  │ → │ UNLOAD   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
     │              │              │              │              │
     ▼              ▼              ▼              ▼              ▼
  Registry      Admin UI      Permission      Event Loop    Cleanup
  Lookup        Approval      Validation      + Signals     Resources
```

## Phase Details

### Discovery

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

### Installation

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

### Initialization

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
