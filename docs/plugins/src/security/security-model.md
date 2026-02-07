# Security Model

## Security Principles

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

## Capability Validation

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

## Resource Limits

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

## Audit Logging

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
