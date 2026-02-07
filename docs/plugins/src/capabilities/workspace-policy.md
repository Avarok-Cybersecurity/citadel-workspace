# Workspace Permission Policy

Workspace owners can define what plugin capabilities are allowed through a **permission policy**. This policy is stored in workspace metadata and enforced at plugin installation time.

## Policy Configuration Schema

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

## New Domain Permissions

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

## Policy Validation Pipeline

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

## Validation Precedence Order

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
