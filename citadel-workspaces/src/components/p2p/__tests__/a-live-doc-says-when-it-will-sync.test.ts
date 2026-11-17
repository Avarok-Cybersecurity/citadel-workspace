/**
 * A Live Doc shared with someone offline says when it will sync.
 *
 * Found live (2026-09-29): with Thomas Braun offline the document's status read
 * "Syncing..." with a pulsing dot, indefinitely -- a claim that something was
 * happening, when it was waiting for him to come back.
 */
import { describe, it, expect } from 'vitest';
import { liveDocSyncLabel, type LiveDocSyncLabel } from '../live-doc-sync-label';

describe('liveDocSyncLabel', () => {
  const WAITING: string = 'Waiting for Thomas Braun — your edits sync when you connect';

  it('says it is waiting for the other person while the link is down', () => {
    const label: LiveDocSyncLabel = liveDocSyncLabel('syncing', false, 'Thomas Braun');
    expect(label.text).toBe(WAITING);
    expect(label.pulsing).toBe(false);
  });

  it('says so while still connecting, too', () => {
    expect(liveDocSyncLabel('connecting', false, 'Thomas Braun').text).toBe(WAITING);
  });

  it('reports syncing and connecting as before while the link is up', () => {
    expect(liveDocSyncLabel('syncing', true, 'Thomas Braun')).toEqual({ text: 'Syncing...', tone: 'warning', pulsing: true });
    expect(liveDocSyncLabel('connecting', true, 'Thomas Braun')).toEqual({ text: 'Connecting...', tone: 'muted', pulsing: false });
  });

  it('is Synced once in step, link or not', () => {
    expect(liveDocSyncLabel('synced', false, 'Thomas Braun')).toEqual({ text: 'Synced', tone: 'success', pulsing: false });
  });
});
