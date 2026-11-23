/**
 * The app worker as the app-page harness watches it: the shipped spawn (spawn-app-worker.ts),
 * with each event the host sends and each `done` the worker answers counted, and each `notify`
 * call the guest makes. "Every event the host sent is done" is how the check knows the app has
 * handled the last message the scripted agent delivered, so a count it reads then is final: no
 * fixed wait stands in for it. The AppContext each instance is loaded with is read back from its
 * CBOR, so the check sees what the app was told: where it runs, and as whom.
 */
import { spawnAppWorker } from '@/lib/citadel-apps/host/spawn-app-worker';
import { decodeCbor, isCborMap, type Decoded } from '@/lib/citadel-apps/host/cbor';
import type { HostChannel, ToWorker } from '@/lib/citadel-apps/host/worker-protocol';

/** The AppContext fields the check reads, as the instance was loaded with them. */
export interface LoadedContext {
  readonly surface: string;
  readonly acting_username: unknown;
  readonly install_id: unknown;
  readonly node_id: unknown;
  readonly app_id: unknown;
}

export interface WorkerProbe {
  /** Events sent and not yet answered `done`, across every worker spawned here. */
  pendingEvents: number;
  eventsDone: number;
  /** The guest's `notify` calls (group `notify`), in the order it made them. */
  notifyCalls: number;
  /** Frames the host delivered (the app asks for them while its tree moves). */
  frames: number;
  /** What the worker sent, by kind: `regions` per frame drawn, `busy` per event it was too busy for, ... */
  fromWorker: Record<string, number>;
  /** One per instance loaded, in order. */
  contexts: LoadedContext[];
}

function contextOf(bytes: Uint8Array): LoadedContext | null {
  const d: Decoded = decodeCbor(bytes);
  if (!d.ok || !isCborMap(d.value)) return null;
  const c: Record<string, unknown> = d.value;
  const surface: string = isCborMap(c.surface) ? Object.keys(c.surface).join(',') : String(c.surface);
  return { surface, acting_username: c.acting_username, install_id: c.install_id, node_id: c.node_id, app_id: c.app_id };
}

export function watchedSpawn(probe: WorkerProbe): () => HostChannel {
  return (): HostChannel => {
    const worker: HostChannel = spawnAppWorker();
    const pending: Set<number> = new Set<number>();
    worker.addEventListener('message', (event: MessageEvent<unknown>): void => {
      const m: { kind?: unknown; seq?: unknown; group?: unknown } = typeof event.data === 'object' && event.data !== null ? (event.data as { kind?: unknown }) : {};
      if (m.kind === 'done' && typeof m.seq === 'number' && pending.delete(m.seq)) {
        probe.pendingEvents--;
        probe.eventsDone++;
      }
      if (m.kind === 'port_call' && m.group === 'notify') probe.notifyCalls++;
      if (typeof m.kind === 'string') probe.fromWorker[m.kind] = (probe.fromWorker[m.kind] ?? 0) + 1;
    });
    return {
      postMessage: (m: ToWorker, t: Transferable[]): void => {
        if (m.kind === 'frame') probe.frames++;
        if (m.kind === 'load') {
          const c: LoadedContext | null = contextOf(m.context);
          if (c !== null) probe.contexts.push(c);
        }
        if (m.kind === 'event') {
          pending.add(m.seq);
          probe.pendingEvents++;
        }
        worker.postMessage(m, t);
      },
      addEventListener: (type, listener) => worker.addEventListener(type, listener),
      terminate: (): void => {
        probe.pendingEvents -= pending.size;
        pending.clear();
        worker.terminate();
      },
    };
  };
}
