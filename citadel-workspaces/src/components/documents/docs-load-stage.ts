/**
 * Where Citadel Docs is in loading, for its pane's loading indicator: the code arriving, then the
 * engine's binary downloading in the worker, then the document opening. Pure.
 */
import type { LoadStage } from '@/lib/app-loading/load-stage';
import type { EngineLoad } from '@/lib/cdoc/worker/engine-load';

/** `engine` is null while the runtime itself is still loading (no worker to report yet). */
export function docsLoadStage(engine: EngineLoad | null): LoadStage {
  if (engine === null) return { kind: 'app' };
  switch (engine.kind) {
    // The opener asks for the engine at once, so a runtime that has not reported yet is about to.
    case 'waiting':
      return { kind: 'engine', bytes: null };
    case 'downloading':
      return { kind: 'engine', bytes: engine.bytes };
    case 'ready':
      return { kind: 'document' };
  }
}
