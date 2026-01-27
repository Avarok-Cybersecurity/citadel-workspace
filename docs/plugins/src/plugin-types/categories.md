# Plugin Types & Categories

## Plugin Type Taxonomy

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

## Plugin Examples by Category

### UI Plugin: Custom Dashboard Widget

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

### Service Plugin: Build Compiler

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

### Integration Plugin: SSH Connector

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

### Workflow Plugin: Incident Router

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
