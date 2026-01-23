# Frontend Plugin System

## Plugin Host Architecture

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

## MDX Component Registry Integration

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

## Event Integration

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
