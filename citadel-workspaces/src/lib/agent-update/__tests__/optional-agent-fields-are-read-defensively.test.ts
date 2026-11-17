/**
 * The agent will report more than today's bindings carry (an update channel, download progress,
 * a size, release notes, an ML-DSA verdict). None of it is typed yet, so each is read from an
 * untyped object and kept only when it has the right shape. A wrong shape is not a value: it is
 * the same as the agent not saying, and in particular never a claim of verification.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readAvailableExtras, readStatusExtras, verificationLabel, SIGSTORE_LABEL } from '../updater-extras';
import { agentUpdate, applyUpdaterMessage, updaterSettings } from '../update-state';
import { available } from './fake-updater';

beforeEach(() => { agentUpdate.set(null); updaterSettings.set(null); });

describe('status extras', () => {
  it('reads a channel, a progress fraction and an ML-DSA verdict when they are well-formed', () => {
    expect(readStatusExtras({ channel: 'stable', download_progress: 0.4, ml_dsa_verified: true }))
      .toEqual({ channel: 'stable', downloadProgress: 0.4, mlDsaVerified: true });
  });

  it('derives progress from byte counts, and clamps what a confused agent could send', () => {
    expect(readStatusExtras({ downloaded_bytes: 25, total_bytes: 100 }).downloadProgress).toBe(0.25);
    expect(readStatusExtras({ download_progress: 7 }).downloadProgress).toBe(1);
    expect(readStatusExtras({ download_progress: -1 }).downloadProgress).toBe(0);
    expect(readStatusExtras({ downloaded_bytes: 5n, total_bytes: 10n }).downloadProgress).toBe(0.5);
  });

  it('ignores a wrong shape instead of guessing', () => {
    expect(readStatusExtras({ channel: 3, download_progress: 'half', ml_dsa_verified: 'yes', total_bytes: 0 })).toEqual({});
    expect(readStatusExtras({ channel: '   ' })).toEqual({});
    expect(readStatusExtras(null)).toEqual({});
    expect(readStatusExtras('x')).toEqual({});
  });
});

describe('available extras', () => {
  it('reads a size and release notes, as numbers and text', () => {
    expect(readAvailableExtras({ size_bytes: 52_428_800, release_notes: '- faster' })).toEqual({ sizeBytes: 52_428_800, notes: '- faster' });
    expect(readAvailableExtras({ size_bytes: 1024n })).toEqual({ sizeBytes: 1024 });
  });

  it('drops a size that is not a positive number, and notes that are not text or are empty', () => {
    expect(readAvailableExtras({ size_bytes: -5, release_notes: 12 })).toEqual({});
    expect(readAvailableExtras({ size_bytes: 0, release_notes: '  ' })).toEqual({});
  });

  it('bounds notes, so an agent cannot make the page render a book', () => {
    expect(readAvailableExtras({ release_notes: 'x'.repeat(100_000) }).notes?.length).toBeLessThanOrEqual(20_000);
  });
});

describe('what the stores keep', () => {
  it('carries the extras from a status answer and from an available broadcast', () => {
    applyUpdaterMessage({ UpdateStatus: { cid: 0n, current: '0.8.8', available: { ...available(false), size_bytes: 10, release_notes: 'Fixes' }, auto_install: true, last_checked: 1n, last_error: null, request_id: 'r', channel: 'beta', download_progress: 0.5 } });
    expect(updaterSettings.get()).toMatchObject({ channel: 'beta', downloadProgress: 0.5 });
    expect(agentUpdate.get()).toMatchObject({ sizeBytes: 10, notes: 'Fixes' });
  });

  it('leaves them out entirely for today\'s agent, so its settings are exactly what they were', () => {
    applyUpdaterMessage({ UpdateStatus: { cid: 0n, current: '0.8.8', available: null, auto_install: true, last_checked: 1n, last_error: null, request_id: 'r' } });
    expect(Object.keys(updaterSettings.get() ?? {}).sort()).toEqual(['autoInstall', 'current', 'lastChecked', 'lastError']);
  });
});

describe('the verification claim', () => {
  it('is Sigstore plus the platform signature until the agent reports ML-DSA', () => {
    expect(verificationLabel({})).toBe(SIGSTORE_LABEL);
    expect(verificationLabel({ mlDsaVerified: false })).toBe(SIGSTORE_LABEL);
  });

  it('adds ML-DSA only when the agent says it verified it', () => {
    expect(verificationLabel({ mlDsaVerified: true })).toMatch(/ML-DSA/);
  });
});
