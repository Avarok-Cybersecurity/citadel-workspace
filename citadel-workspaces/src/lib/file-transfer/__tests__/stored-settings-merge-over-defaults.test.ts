/**
 * Per-peer transfer settings are read back from localStorage, written by
 * whatever version of the app the user last ran. Returning that blob verbatim
 * means any field added since arrives `undefined` — `allowRevfsStorage` reads as
 * off, silently disabling RE-VFS for that peer, and `revfsQuota` renders as
 * `NaN` MB in the settings UI.
 *
 * The settings tabs elsewhere in the app already spread over their defaults;
 * this one returned `stored` directly. The test is written against a
 * deliberately-old shape, which is the only thing that can distinguish the two.
 */
import { describe, it, expect } from 'vitest';
import { FileTransferState } from '../state';
import type { FileTransferSettings } from '../types';

describe('FileTransferState.getSettings', () => {
  it('fills in fields a previous version never saved', () => {
    const state: FileTransferState = new FileTransferState();

    // What a user who saved settings before `allowRevfsStorage` and
    // `revfsQuota` existed has sitting in localStorage today.
    const legacy: { autoAccept: boolean; maxFileSize: number; transferMode: string; } = { autoAccept: true, maxFileSize: 1234, transferMode: 'browser' };
    state.setSettings('42', legacy as unknown as FileTransferSettings);

    const settings: FileTransferSettings = state.getSettings('42');

    // Their own choices survive.
    expect(settings.autoAccept).toBe(true);
    expect(settings.maxFileSize).toBe(1234);

    // And the fields they never saw take their documented defaults rather than
    // arriving undefined.
    expect(settings.allowRevfsStorage).toBe(FileTransferState.DEFAULT_SETTINGS.allowRevfsStorage);
    expect(settings.revfsQuota).toBe(FileTransferState.DEFAULT_SETTINGS.revfsQuota);
    expect(Number.isNaN(settings.revfsQuota)).toBe(false);
  });

  it('still returns pure defaults for a peer with nothing saved', () => {
    const state: FileTransferState = new FileTransferState();
    expect(state.getSettings('99')).toEqual(FileTransferState.DEFAULT_SETTINGS);
  });

  it('does not let a stored value be overridden by its default', () => {
    const state: FileTransferState = new FileTransferState();
    state.setSettings('7', {
      ...FileTransferState.DEFAULT_SETTINGS,
      allowRevfsStorage: false,
    });
    // Spread order matters: defaults first, stored second.
    expect(state.getSettings('7').allowRevfsStorage).toBe(false);
  });

  it('loads settings saved with the removed transfer method, and drops it', () => {
    // Saved before there was one way to send: `transferMode` was a per-peer choice.
    const state: FileTransferState = new FileTransferState();
    const saved: Record<string, unknown> = { ...FileTransferState.DEFAULT_SETTINGS, autoAccept: true, transferMode: 'protocol' };
    state.setSettings('5', saved as unknown as FileTransferSettings);
    const settings: FileTransferSettings = state.getSettings('5');
    expect(settings.autoAccept).toBe(true);
    expect(settings).not.toHaveProperty('transferMode');
    expect(Object.keys(settings).sort()).toEqual(Object.keys(FileTransferState.DEFAULT_SETTINGS).sort());
  });
});
