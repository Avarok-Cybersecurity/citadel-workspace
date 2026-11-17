/**
 * Loads the REVFS engine on demand, and keeps its two callers ordered.
 *
 * `lib/p2p/message-handler-routing` and `components/hooks/useConnectionHandler`
 * are both on the landing page's critical path. A static
 * `import { revfsService } from '@/lib/revfs'` in either one put the whole sync
 * engine there: 8.6 KB fetched before the landing page could render, for a
 * subsystem that can do nothing until a workspace is open and a peer sends a
 * sync operation. Deferring only one of the two did not help -- Rollup simply
 * moved the engine from the `app-services` chunk into the entry chunk, which is
 * equally eager. Both had to go.
 *
 * They cannot become two independent dynamic imports, though: the router may
 * only hand an operation to a service that already has its transport. Routing
 * both through this module makes that ordering explicit instead of relying on
 * an effect happening to run first.
 */
import type { RevfsIODeps } from './revfs-io';

type RevfsModule = typeof import('./index');

let loading: Promise<RevfsModule> | null = null;
/** Callers waiting for `startRevfs`; see `revfsWhenStarted`. */
let waiters: ((module: Promise<RevfsModule>) => void)[] = [];

/**
 * Begins loading the engine and initializes it with its transport.
 *
 * Idempotent: the first call wins and later ones get the same promise, so a
 * remount cannot reinitialize a service that is already handling operations.
 */
export function startRevfs(deps: RevfsIODeps): Promise<RevfsModule> {
  if (loading === null) {
    loading = import('./index').then((module: RevfsModule): RevfsModule => {
      module.revfsService.initialize(deps);
      return module;
    });
    const started: Promise<RevfsModule> = loading;
    for (const wake of waiters) wake(started);
    waiters = [];
  }
  return loading;
}

/**
 * The in-flight load, or null when `startRevfs` has not been called.
 *
 * Null rather than starting the import here: a caller that reaches the engine
 * before it has been configured must be able to tell, instead of silently
 * receiving one whose `initialize` has never run and whose every operation
 * would throw.
 */
export function revfsWhenReady(): Promise<RevfsModule> | null {
  return loading;
}

/**
 * The engine once `startRevfs` has been called, waiting up to `timeoutMs` for
 * that; null if it never was.
 *
 * For an operation that arrives first. It used to be dropped "to be retried",
 * but only mutations are retried: a SyncRequest dropped here is simply never
 * answered, and the asker is told the peer did not answer.
 */
export function revfsWhenStarted(timeoutMs: number): Promise<RevfsModule | null> {
  if (loading !== null) return loading;
  return new Promise<RevfsModule | null>((resolve): void => {
    const wake = (module: Promise<RevfsModule>): void => { clearTimeout(timer); resolve(module); };
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      waiters = waiters.filter((w) => w !== wake);
      resolve(null);
    }, timeoutMs);
    waiters.push(wake);
  });
}

/** Test seam: the module-level promise outlives an import. */
export function forgetRevfsLoad(): void {
  loading = null;
  waiters = [];
}
