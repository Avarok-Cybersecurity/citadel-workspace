/**
 * What makes a page's zones read their installs again: this tab's own install answers, and the
 * server's notice that another member changed one (without it, a member's zone kept running an
 * install the admin had removed, and never started its replacement). A member's own peer answers
 * change no install, so they restart nothing.
 */
import { describe, expect, it } from 'vitest';
import { changesInstalls } from '../zone-data';

describe('what reads a page’s installs again', () => {
  it('another member’s install change, as the server’s notice', () => {
    expect(changesInstalls('InstallsChanged')).toBe(true);
    expect(changesInstalls({ Uninstalled: { install_id: 'i-1' } })).toBe(true);
  });

  it('control: a change of peer answers, or anything unknown, does not', () => {
    expect(changesInstalls('PeerAnswersChanged')).toBe(false);
    expect(changesInstalls('SomethingElse')).toBe(false);
  });
});
