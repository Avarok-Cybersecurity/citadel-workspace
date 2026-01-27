# CitadelWorkspacePlugin Abstract Class

All plugins must implement the `CitadelWorkspacePlugin` interface. Two implementations are provided: TypeScript for open-source distribution and Rust for closed-source WASM compilation.

## TypeScript Implementation (Open Source)

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

## Rust Implementation (Closed Source WASM)

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
