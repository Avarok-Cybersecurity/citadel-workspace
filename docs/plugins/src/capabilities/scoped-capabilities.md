# Scoped Capabilities

Capabilities can be **scoped** for fine-grained security. Unscoped capabilities grant broad access; scoped capabilities are restricted to specific resources.

## Scoped Capability Types

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

## Capability → Permission Mapping

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

## Scope Enforcement at Runtime

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
