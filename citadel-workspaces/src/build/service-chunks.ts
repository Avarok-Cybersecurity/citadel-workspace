import type { ManualChunkMeta } from 'rollup';

/**
 * Which chunk a service-layer module belongs in.
 *
 * These directories are kept whole because their barrels cycle (see the
 * comment in vite.config.ts). Keeping them whole used to mean ONE chunk, and
 * that chunk is on the landing page's critical path — so every service module
 * went with it, including the P2P messenger that the landing page never
 * statically reaches and main.tsx loads with a dynamic import after first
 * paint. Forcing it into the eager chunk undid that dynamic import.
 *
 * Splitting by static reachability keeps both properties: each half is still
 * whole, and no static edge can run from the eager half to the deferred one —
 * a module statically imported by a reachable module is reachable by
 * definition — so no chunk cycle can form between them.
 */
export const EAGER_SERVICES_CHUNK: string = 'app-services';
export const DEFERRED_SERVICES_CHUNK: string = 'app-services-deferred';

const SERVICE_DIR: RegExp = /[\\/]src[\\/]lib[\\/](p2p|connection-service|peer-registration-store)[\\/]/;

interface ServiceGraph {
  /** Statically reachable from an entry: everything the landing page downloads first. */
  eager: ReadonlySet<string>;
  /** Statically reachable from a deferred service module. */
  underDeferred: ReadonlySet<string>;
}

const graphFor: WeakMap<ManualChunkMeta['getModuleInfo'], ServiceGraph> = new WeakMap();

function closure(meta: ManualChunkMeta, roots: readonly string[]): Set<string> {
  const seen: Set<string> = new Set(roots);
  const queue: string[] = [...roots];
  for (let i: number = 0; i < queue.length; i++) {
    for (const next of meta.getModuleInfo(queue[i])?.importedIds ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

function serviceGraph(meta: ManualChunkMeta): ServiceGraph {
  const cached: ServiceGraph | undefined = graphFor.get(meta.getModuleInfo);
  if (cached) return cached;

  const ids: string[] = [...meta.getModuleIds()];
  const eager: Set<string> = closure(meta, ids.filter((id: string) => meta.getModuleInfo(id)?.isEntry === true));
  const underDeferred: Set<string> = closure(meta, ids.filter((id: string) => SERVICE_DIR.test(id) && !eager.has(id)));
  const graph: ServiceGraph = { eager, underDeferred };
  graphFor.set(meta.getModuleInfo, graph);
  return graph;
}

export function serviceChunkFor(id: string, meta: ManualChunkMeta): string | undefined {
  if (!SERVICE_DIR.test(id)) return undefined;
  return serviceGraph(meta).eager.has(id) ? EAGER_SERVICES_CHUNK : DEFERRED_SERVICES_CHUNK;
}

/**
 * For a module no other rule claimed: keep it out of the deferred chunk.
 *
 * Rollup moves a manual chunk's unclaimed dependencies INTO that chunk. A
 * utility the landing page and the messenger both import would therefore land
 * in the deferred chunk, the entry would import it from there, and the whole
 * deferred chunk would be modulepreloaded onto the critical path again. Claiming
 * such shared modules for the eager chunk — where they were before the split —
 * is what keeps the deferred one deferred.
 */
export function sharedServiceDependencyChunkFor(id: string, meta: ManualChunkMeta): string | undefined {
  const graph: ServiceGraph = serviceGraph(meta);
  return graph.eager.has(id) && graph.underDeferred.has(id) ? EAGER_SERVICES_CHUNK : undefined;
}
