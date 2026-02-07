# Admin & User UX Flows

## Admin: Plugin Installation Flow

When a workspace admin installs a plugin, they see a detailed permission review:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INSTALL PLUGIN: "Server Monitor Pro"                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  com.citadel-labs.server-monitor-pro                                │   │
│  │                                                                      │   │
│  │  Publisher: Citadel Labs (Verified)                                 │   │
│  │  Version: 2.1.0                                                      │   │
│  │  Category: Infrastructure                                            │   │
│  │  License: Commercial                                                 │   │
│  │  Downloads: 12,345  4.8 (234 reviews)                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  REQUIRED PERMISSIONS                                                │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │  This plugin requires the following capabilities:                    │   │
│  │                                                                       │   │
│  │  ┌──────────────────────┬──────────────┬─────────────────────────┐  │   │
│  │  │ Permission           │ Level        │ Justification           │  │   │
│  │  ├──────────────────────┼──────────────┼─────────────────────────┤  │   │
│  │  │ ui:panels            │ Interact     │ Display monitoring panel│  │   │
│  │  │ ui:components        │ Interact     │ ServerStatus widget     │  │   │
│  │  │ signals:emit         │ Interact     │ Emit server alerts      │  │   │
│  │  │ signals:propagate    │ Modify       │ Escalate incidents      │  │   │
│  │  │ network:connect      │ System       │ Connect to servers      │  │   │
│  │  │   → 10.0.0.0/8:22    │              │   (SSH monitoring)      │  │   │
│  │  │   → 10.0.0.0/8:443   │              │   (HTTPS metrics)       │  │   │
│  │  └──────────────────────┴──────────────┴─────────────────────────┘  │   │
│  │                                                                       │   │
│  │  Level Legend: Observe  Interact  Modify  Manage  System             │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  All requested capabilities are within workspace policy              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [ View Source ]  [ View Reviews ]  [ Cancel ]  [ Approve & Install ]      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## User: First-Join Security/Privacy Modal

When a user first joins a workspace with plugins installed:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  WORKSPACE SECURITY & PRIVACY                                               │
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
│  │ Read workspace data   │    Y     │ All plugins                       │   │
│  │ Display UI panels     │    Y     │ Server Monitor, IDE               │   │
│  │ Register MDX          │    Y     │ IDE, Kanban Board                 │   │
│  │   components          │          │                                   │   │
│  │ Emit signals          │    Y     │ Server Monitor, Incident Router   │   │
│  │ Propagate signals     │    Y     │ Incident Router                   │   │
│  │ Send P2P messages     │    Y     │ Incident Router                   │   │
│  │ Edit MDX content      │    Y     │ IDE                               │   │
│  │ Read filesystem       │    !     │ IDE                               │   │
│  │   /projects/*         │          │   (scoped to project files)       │   │
│  │ Write filesystem      │    !     │ IDE                               │   │
│  │   /projects/*         │          │   (scoped to project files)       │   │
│  │ Spawn processes       │    !     │ IDE                               │   │
│  │   cargo, npm, node    │          │   (build tools only)              │   │
│  │ Network connections   │    !     │ Server Monitor                    │   │
│  │   10.0.0.0/8          │          │   (internal network only)         │   │
│  └───────────────────────┴──────────┴───────────────────────────────────┘   │
│                                                                             │
│  Legend:  Y = Standard permission    ! = Elevated (Level 4) permission     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Your data is protected:                                            │   │
│  │  • Plugins cannot access your credentials or private messages        │   │
│  │  • All plugin actions are logged and auditable                       │   │
│  │  • You can revoke plugin access at any time in Settings              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [ View Plugin Details ]    [ Leave Workspace ]    [ Accept & Continue ]   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Admin: Policy Violation on Install

When a secondary admin (with `ManagePlugins` but not `ConfigurePluginPolicy`) tries to install a plugin that exceeds the workspace policy:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INSTALLATION BLOCKED                                                        │
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
│  │ network: 0.0.0.0/0    │ 10.0.0.0/8 only   │ Scope too broad         │   │
│  │ fs:write: /           │ /projects, /tmp   │ Path not allowed        │   │
│  │ process: any          │ cargo, npm, node  │ Scope required          │   │
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

## Permission Aggregation Logic

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
