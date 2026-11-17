import { describe, expect, it } from 'vitest';
import type { ManualChunkMeta, ModuleInfo } from 'rollup';
import {
  DEFERRED_SERVICES_CHUNK,
  EAGER_SERVICES_CHUNK,
  serviceChunkFor,
  sharedServiceDependencyChunkFor,
} from '../service-chunks';

/**
 * A module graph shaped like the one that put the messenger on the landing
 * page: the entry reaches one service module statically, and reaches the
 * messenger only through a dynamic import. Both service modules share a util.
 */
const ENTRY: string = '/app/src/main.tsx';
const EAGER_SERVICE: string = '/app/src/lib/connection-service/service.ts';
const MESSENGER: string = '/app/src/lib/p2p/p2p-messenger-manager.ts';
const SHARED_UTIL: string = '/app/src/lib/debug-config.ts';
const MESSENGER_ONLY: string = '/app/src/lib/group-conversations/group-store.ts';
const UNRELATED: string = '/app/src/pages/Landing.tsx';

const staticImports: Record<string, string[]> = {
  [ENTRY]: [EAGER_SERVICE, UNRELATED],
  [EAGER_SERVICE]: [SHARED_UTIL],
  [MESSENGER]: [SHARED_UTIL, MESSENGER_ONLY],
  [SHARED_UTIL]: [],
  [MESSENGER_ONLY]: [],
  [UNRELATED]: [],
};

function metaFor(imports: Record<string, string[]>): ManualChunkMeta {
  const getModuleInfo: ManualChunkMeta['getModuleInfo'] = (id: string): ModuleInfo | null =>
    id in imports ? ({ id, isEntry: id === ENTRY, importedIds: imports[id] } as unknown as ModuleInfo) : null;
  return { getModuleIds: () => Object.keys(imports)[Symbol.iterator](), getModuleInfo };
}

describe('service chunk assignment', () => {
  it('keeps a service module the entry reaches statically in the eager chunk', () => {
    expect(serviceChunkFor(EAGER_SERVICE, metaFor(staticImports))).toBe(EAGER_SERVICES_CHUNK);
  });

  it('puts a service module reached only dynamically in the deferred chunk', () => {
    expect(serviceChunkFor(MESSENGER, metaFor(staticImports))).toBe(DEFERRED_SERVICES_CHUNK);
  });

  it('moves the messenger back to the eager chunk the moment something imports it statically', () => {
    const regressed: Record<string, string[]> = { ...staticImports, [UNRELATED]: [MESSENGER] };
    expect(serviceChunkFor(MESSENGER, metaFor(regressed))).toBe(EAGER_SERVICES_CHUNK);
  });

  it('claims a util both halves import for the eager chunk, so the deferred one is not preloaded for it', () => {
    expect(sharedServiceDependencyChunkFor(SHARED_UTIL, metaFor(staticImports))).toBe(EAGER_SERVICES_CHUNK);
  });

  it('leaves unshared and unrelated modules to the default chunking', () => {
    const meta: ManualChunkMeta = metaFor(staticImports);
    expect(sharedServiceDependencyChunkFor(MESSENGER_ONLY, meta)).toBeUndefined();
    expect(sharedServiceDependencyChunkFor(UNRELATED, meta)).toBeUndefined();
    expect(serviceChunkFor(UNRELATED, meta)).toBeUndefined();
  });
});
