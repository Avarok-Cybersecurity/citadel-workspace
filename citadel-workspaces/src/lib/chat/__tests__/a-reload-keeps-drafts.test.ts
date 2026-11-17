/**
 * A reload the app asks for keeps what the user was typing.
 *
 * Drafts are held in memory, so the deploy banner's Reload, and the automatic
 * reload after a superseded chunk, used to discard every half-written message.
 * jsdom's real sessionStorage is used; nothing is mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllDraftsForTests, loadDraft, saveDraft } from '../draft-store';
import {
  DRAFT_HANDOFF_KEY,
  reloadKeepingDrafts,
  restoreHandedOffDrafts,
  takeStashedDrafts,
} from '../draft-handoff';

describe('a reload the app starts', () => {
  beforeEach(() => {
    clearAllDraftsForTests();
    window.sessionStorage.clear();
  });

  it('carries every draft across it, and leaves nothing behind afterwards', () => {
    saveDraft('peer:alice', 'half a thought');
    saveDraft('group:7', 'another');
    const reload: ReturnType<typeof vi.fn> = vi.fn();

    reloadKeepingDrafts(window.sessionStorage, reload);
    expect(reload).toHaveBeenCalledOnce();

    clearAllDraftsForTests(); // what the reload does to memory
    restoreHandedOffDrafts(window.sessionStorage);

    expect(loadDraft('peer:alice')).toBe('half a thought');
    expect(loadDraft('group:7')).toBe('another');
    expect(window.sessionStorage.getItem(DRAFT_HANDOFF_KEY)).toBeNull();
  });

  it('does not overwrite a draft typed since', () => {
    saveDraft('peer:alice', 'old');
    reloadKeepingDrafts(window.sessionStorage, () => undefined);
    saveDraft('peer:alice', 'newer');
    restoreHandedOffDrafts(window.sessionStorage);
    expect(loadDraft('peer:alice')).toBe('newer');
  });

  it('still reloads when there is no storage to carry them in', () => {
    const reload: ReturnType<typeof vi.fn> = vi.fn();
    reloadKeepingDrafts(null, reload);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('discards a handoff that is not the shape it wrote', () => {
    window.sessionStorage.setItem(DRAFT_HANDOFF_KEY, '{not json');
    expect(takeStashedDrafts(window.sessionStorage)).toEqual([]);
    window.sessionStorage.setItem(DRAFT_HANDOFF_KEY, JSON.stringify([['k', 'v'], ['k2', 3], 'x']));
    expect(takeStashedDrafts(window.sessionStorage)).toEqual([['k', 'v']]);
    expect(window.sessionStorage.getItem(DRAFT_HANDOFF_KEY)).toBeNull();
  });
});
