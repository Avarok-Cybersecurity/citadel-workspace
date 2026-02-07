# Plugin Handle API

The Plugin Handle is the primary API surface exposed to plugins. It provides capability-gated access to workspace functionality.

## Handle Architecture

```typescript
interface PluginHandle {
  // Identity
  readonly pluginId: string;
  readonly instanceId: string;
  readonly domain: DomainContext;

  // Capability checking
  hasCapability(capability: PluginCapability): boolean;
  requestCapability(capability: PluginCapability): Promise<boolean>;

  // Sub-handles (capability-gated)
  readonly ui: UIHandle | null;
  readonly mdx: MDXHandle | null;
  readonly signals: SignalHandle | null;
  readonly data: DataHandle | null;
  readonly members: MembersHandle | null;
  readonly fs: FileSystemHandle | null;      // Level 4
  readonly process: ProcessHandle | null;    // Level 4
  readonly network: NetworkHandle | null;    // Level 4
}
```

## UI Handle

```typescript
interface UIHandle {
  // Component Registration (Level 1)
  registerComponent(name: string, component: React.ComponentType<any>): void;
  unregisterComponent(name: string): void;

  // Panel Registration (Level 1)
  registerPanel(config: PanelConfig): PanelInstance;

  // DOM Injection (Level 2)
  inject(selector: string, content: InjectableContent): InjectionHandle;

  // Event Observation (Level 0)
  onEvent<T extends UIEvent>(
    event: T["type"],
    handler: (event: T) => void
  ): () => void;

  // State Reading (Level 0)
  getState(): UIState;

  // Theming (Level 1)
  registerTheme(theme: ThemeDefinition): void;
}

interface PanelConfig {
  id: string;
  title: string;
  location: "sidebar-left" | "sidebar-right" | "bottom" | "modal" | "floating";
  component: React.ComponentType<PanelProps>;
  icon?: React.ComponentType;
  defaultVisible?: boolean;
  resizable?: boolean;
  minWidth?: number;
  maxWidth?: number;
}

type InjectableContent =
  | { type: "html"; html: string }
  | { type: "component"; component: React.ComponentType<any>; props?: any }
  | { type: "widget"; widgetId: string; config?: any };

interface InjectionHandle {
  update(content: InjectableContent): void;
  remove(): void;
  readonly isActive: boolean;
}
```

## MDX Handle

```typescript
interface MDXHandle {
  // Reading (Level 0)
  getContent(domainId: string): Promise<string>;

  // Editing (Level 2)
  setContent(domainId: string, content: string): Promise<void>;
  patchContent(domainId: string, patches: MDXPatch[]): Promise<void>;

  // Live Editing (Level 2)
  createEditSession(domainId: string): MDXEditSession;

  // Component Context (Level 1)
  registerMdxComponent(name: string, component: React.ComponentType<any>): void;

  // Transformation (Level 2)
  registerTransformer(transformer: MDXTransformer): void;
}

interface MDXPatch {
  type: "insert" | "delete" | "replace";
  range: { start: number; end: number };
  content?: string;
}

interface MDXEditSession {
  readonly domainId: string;
  readonly content: string;

  onChange(handler: (content: string) => void): () => void;
  applyPatch(patch: MDXPatch): void;
  save(): Promise<void>;
  discard(): void;
}

interface MDXTransformer {
  name: string;
  priority: number;  // Higher runs first
  transform(ast: MDXAst, context: TransformContext): MDXAst;
}
```

## Signal Handle

```typescript
interface SignalHandle {
  // Subscription (Level 0)
  subscribe<T extends Signal>(
    pattern: string,
    handler: (signal: T) => void
  ): () => void;

  // Emission (Level 1)
  emit<T extends Signal>(signal: T): void;

  // Propagation (Level 2)
  propagate<T extends Signal>(
    signal: T,
    direction: PropagationDirection,
    options?: PropagationOptions
  ): void;

  // Broadcast (Level 4)
  broadcast<T extends Signal>(signal: T): void;
}

type PropagationDirection = "up" | "down" | "both" | "siblings";

interface PropagationOptions {
  stopAt?: string[];        // Domain IDs to stop at
  skipDomains?: string[];   // Domain IDs to skip
  transform?: (signal: Signal, domain: Domain) => Signal | null;
}
```

## Data Handle

```typescript
interface DataHandle {
  // Domain Data (Level 0/2)
  getWorkspace(): Promise<Workspace>;
  getOffice(officeId: string): Promise<Office>;
  getRoom(roomId: string): Promise<Room>;

  // Updates require Level 2
  updateWorkspace(updates: Partial<WorkspaceUpdate>): Promise<void>;
  updateOffice(officeId: string, updates: Partial<OfficeUpdate>): Promise<void>;
  updateRoom(roomId: string, updates: Partial<RoomUpdate>): Promise<void>;

  // Plugin-specific storage
  readonly storage: PluginStorage;
}

interface PluginStorage {
  // Scoped to plugin + domain
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;

  // Cross-domain storage (requires Level 3)
  global: GlobalPluginStorage;
}
```

## FileSystem Handle (Level 4)

```typescript
interface FileSystemHandle {
  // Scoped to allowed paths only
  readonly allowedPaths: readonly string[];

  // Reading
  readFile(path: string): Promise<Uint8Array>;
  readTextFile(path: string): Promise<string>;
  readDir(path: string): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;

  // Writing (if fs:write granted)
  writeFile(path: string, content: Uint8Array): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
  mkdir(path: string, options?: MkdirOptions): Promise<void>;
  remove(path: string, options?: RemoveOptions): Promise<void>;
  rename(from: string, to: string): Promise<void>;

  // Watching
  watch(path: string, handler: (event: FsEvent) => void): () => void;
}
```

## Process Handle (Level 4)

```typescript
interface ProcessHandle {
  // Scoped to allowlisted executables only
  readonly allowedExecutables: readonly ProcessAllowEntry[];

  spawn(config: SpawnConfig): Promise<ProcessInstance>;
}

interface SpawnConfig {
  executable: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "pipe" | "inherit" | "null";
  stdout?: "pipe" | "inherit" | "null";
  stderr?: "pipe" | "inherit" | "null";
}

interface ProcessInstance {
  readonly pid: number;
  readonly stdin: WritableStream<Uint8Array> | null;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;

  wait(): Promise<ProcessOutput>;
  kill(signal?: number): void;
}
```
