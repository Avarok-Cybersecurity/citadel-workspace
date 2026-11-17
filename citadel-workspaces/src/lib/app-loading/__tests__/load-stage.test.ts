/** What an app's loading indicator says at each stage, and when it may claim a fraction. Pure. */
import { describe, expect, it } from 'vitest';
import { loadingView, type LoadingView } from '../load-stage';

const MB: number = 1024 * 1024;

describe('the loading view', () => {
  it('says the app is loading, with no fraction, while its code arrives', () => {
    expect(loadingView('Citadel Docs', { kind: 'app' })).toEqual({ label: 'Loading Citadel Docs…', detail: null, fraction: null });
  });

  it('measures an engine download of known size', () => {
    const view: LoadingView = loadingView('Citadel Docs', { kind: 'engine', bytes: { loaded: 1.5 * MB, total: 4 * MB } });
    expect(view).toEqual({ label: 'Downloading the Citadel Docs engine…', detail: '1.5 MB of 4 MB', fraction: 0.375 });
  });

  it('never claims more than all of it, whatever the stream reported', () => {
    expect(loadingView('Citadel Docs', { kind: 'engine', bytes: { loaded: 5 * MB, total: 4 * MB } }).fraction).toBe(1);
  });

  it('counts bytes without a fraction when the size is unknown, and says nothing measured before the first', () => {
    expect(loadingView('Citadel Docs', { kind: 'engine', bytes: { loaded: 2 * MB, total: null } })).toMatchObject({ detail: '2 MB downloaded', fraction: null });
    expect(loadingView('Citadel Docs', { kind: 'engine', bytes: { loaded: 2 * MB, total: 0 } }).fraction).toBeNull();
    expect(loadingView('Citadel Docs', { kind: 'engine', bytes: null })).toMatchObject({ detail: null, fraction: null });
  });

  it('says the document is opening, with no fraction, once the engine is up', () => {
    expect(loadingView('Citadel Docs', { kind: 'document' })).toEqual({ label: 'Opening the document…', detail: null, fraction: null });
  });
});
