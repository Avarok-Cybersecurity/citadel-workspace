# Backend Plugin System

## Plugin Runtime Architecture

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

## Plugin Trait Definition

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

## Plugin Registry

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
