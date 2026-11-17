/** What an app instance is launched with (instance.ts `launchAppInstance`). */
import type { AppContext } from '../sdk/generated/AppContext';
import type { Capability } from './capabilities';
import type { DispatchClock } from './dispatch';
import type { InstanceSlots } from './instance-slots';
import type { HostPolicy, InstanceLimits } from './limits';
import type { HostPorts } from './ports';
import type { HostChannel } from './worker-protocol';

export interface LaunchOptions {
  readonly appId: string;
  /** From an `ok` load verdict: the module has already passed inspect.ts. */
  readonly module: WebAssembly.Module;
  readonly granted: ReadonlySet<Capability>;
  readonly memory: { readonly initialPages: number; readonly maxPages: number };
  readonly context: AppContext;
  /** The install's `limits.close_grace_ms` (the manifest's, validated against MAX_CLOSE_GRACE_MS). */
  readonly closeGraceMs: number;
  /** The page the app is mounted in: what its internal links resolve against. */
  readonly pageUrl: string;
  readonly policy: HostPolicy;
  /** What this instance's manifest holds it to, beyond the page's policy (limits.ts `instanceLimits`). */
  readonly limits: InstanceLimits;
  readonly ports: HostPorts;
  readonly clock: DispatchClock;
  readonly slots: InstanceSlots;
  /** Starts the worker: spawnAppWorker() on a page, a test channel in tests. */
  readonly spawn: () => HostChannel;
}
