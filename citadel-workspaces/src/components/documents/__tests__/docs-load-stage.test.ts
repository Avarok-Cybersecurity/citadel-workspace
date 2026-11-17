/** Citadel Docs' loading stages, from the runtime and its worker's engine report. Pure. */
import { describe, expect, it } from 'vitest';
import { docsLoadStage } from '../docs-load-stage';

describe("Citadel Docs' loading stage", () => {
  it('is the app code until the runtime exists', () => {
    expect(docsLoadStage(null)).toEqual({ kind: 'app' });
  });

  it('is the engine, unmeasured, before the worker reports, then measured as it downloads', () => {
    expect(docsLoadStage({ kind: 'waiting' })).toEqual({ kind: 'engine', bytes: null });
    expect(docsLoadStage({ kind: 'downloading', bytes: { loaded: 10, total: 40 } })).toEqual({ kind: 'engine', bytes: { loaded: 10, total: 40 } });
  });

  it('is the document once the engine is up', () => {
    expect(docsLoadStage({ kind: 'ready' })).toEqual({ kind: 'document' });
  });
});
