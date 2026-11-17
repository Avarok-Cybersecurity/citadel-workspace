/**
 * "You have been fully logged out" has to be true of the device.
 *
 * Sign-out removed the stored session and the tab's selection and left, in
 * localStorage: one `peer-first-seen:<cid>` key per peer the account had ever
 * spoken to, and `citadel:file-transfers` holding the file names, sizes and
 * peer CIDs of every transfer in both directions. Readable afterwards by
 * anyone who opens devtools on that machine.
 *
 * The interesting half of this test is what it asserts is KEPT. Clearing
 * everything would pass a "no residue" check and be its own bug: a user who
 * signs out should not find their font size reset and their privacy switches
 * back at the defaults.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { residueKeys, clearSignOutResidue } from '../sign-out-residue';

describe('what sign-out removes', () => {
  it('takes the transfer history and the per-peer keys', () => {
    expect(
      residueKeys([
        'citadel:file-transfers',
        'citadel:file-transfer-settings',
        'peer-first-seen:12345',
        'peer-first-seen:67890',
      ]).sort(),
    ).toEqual([
      'citadel:file-transfer-settings',
      'citadel:file-transfers',
      'peer-first-seen:12345',
      'peer-first-seen:67890',
    ]);
  });

  it('leaves the settings the user chose', () => {
    // Residue the user cannot see goes; state the user chose stays. A rule that
    // cleared everything would satisfy "no residue" and lose that distinction.
    expect(
      residueKeys([
        'citadel:appearance-settings',
        'citadel:privacy-settings',
        'citadel_recent_servers',
        'citadel:diagnostics',
      ]),
    ).toEqual([]);
  });

  it('does not match a key that merely contains a residue name', () => {
    // Prefix, not substring: `some-other:peer-first-seen:1` is not ours, and a
    // sign-out that deletes keys belonging to something else is worse than one
    // that leaves its own.
    expect(residueKeys(['x-peer-first-seen:1', 'my-citadel:file-transfers'])).toEqual([]);
  });
});

describe('clearing it', () => {
  beforeEach(() => localStorage.clear());

  it('removes the residue and keeps everything else', () => {
    localStorage.setItem('citadel:file-transfers', '{}');
    localStorage.setItem('peer-first-seen:42', '1');
    localStorage.setItem('citadel:appearance-settings', '{"fontSize":14}');

    clearSignOutResidue();

    expect(localStorage.getItem('citadel:file-transfers')).toBeNull();
    expect(localStorage.getItem('peer-first-seen:42')).toBeNull();
    expect(localStorage.getItem('citadel:appearance-settings')).not.toBeNull();
  });

  it('removes every peer key, not just the first', () => {
    // Iterating localStorage while deleting from it shifts the indices, which
    // is the classic way half a list survives a clear.
    for (let i: number = 0; i < 20; i += 1) localStorage.setItem(`peer-first-seen:${i}`, '1');
    clearSignOutResidue();
    expect(localStorage.length).toBe(0);
  });
});
