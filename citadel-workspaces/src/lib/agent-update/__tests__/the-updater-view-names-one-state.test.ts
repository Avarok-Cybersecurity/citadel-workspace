/**
 * Six states, one at a time, chosen from what the agent last said and what this window is
 * doing. The order matters where two are true at once: a check in progress outranks an old
 * error, and an error outranks the update it failed to install.
 */
import { describe, expect, it } from 'vitest';
import { deriveUpdateView, type ViewInput } from '../update-view';
import type { AgentUpdate, UpdaterSettings } from '../update-state';

const settings = (over: Partial<UpdaterSettings> = {}): UpdaterSettings =>
  ({ current: '0.8.8', autoInstall: true, lastChecked: 1_790_000_000n, lastError: null, ...over });
const update = (over: Partial<AgentUpdate> = {}): AgentUpdate =>
  ({ current: '0.8.8', latest: '0.9.0', notesUrl: '', downloadUrl: '', ready: false, ...over });
const input = (over: Partial<ViewInput> = {}): ViewInput => ({ settings: settings(), update: null, checking: false, error: null, ...over });

describe('the update view', () => {
  it('is current with nothing newer', () => {
    expect(deriveUpdateView(input())).toEqual({ kind: 'current', lastChecked: 1_790_000_000n });
  });
  it('is checking while a check runs, even over an old error', () => {
    expect(deriveUpdateView(input({ checking: true, settings: settings({ lastError: 'offline' }) })).kind).toBe('checking');
  });
  it('is an error with the agent\'s words, or this window\'s own failure first', () => {
    expect(deriveUpdateView(input({ settings: settings({ lastError: 'GitHub could not be reached' }) })))
      .toMatchObject({ kind: 'error', message: 'GitHub could not be reached' });
    expect(deriveUpdateView(input({ error: 'The check did not finish.', settings: settings({ lastError: 'old' }) })))
      .toMatchObject({ kind: 'error', message: 'The check did not finish.' });
  });
  it('is available when a release is newer but not downloaded, and ready once it is', () => {
    expect(deriveUpdateView(input({ update: update() })).kind).toBe('available');
    expect(deriveUpdateView(input({ update: update({ ready: true }) })).kind).toBe('ready');
  });
  it('is downloading only when the agent reports progress for an update that is not ready', () => {
    expect(deriveUpdateView(input({ update: update(), settings: settings({ downloadProgress: 0.3 }) })))
      .toMatchObject({ kind: 'downloading', progress: 0.3 });
    expect(deriveUpdateView(input({ update: update({ ready: true }), settings: settings({ downloadProgress: 1 }) })).kind).toBe('ready');
  });
  it('keeps the update inside an error, so the page can still say what it failed to install', () => {
    expect(deriveUpdateView(input({ update: update({ ready: true }), settings: settings({ lastError: 'Nothing was installed' }) })))
      .toMatchObject({ kind: 'error', update: { latest: '0.9.0' } });
  });
});
