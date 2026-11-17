/**
 * Half-written messages, and the click that used to destroy them.
 *
 * The composer's text was component state and the chat is keyed by peer — that
 * keying is deliberate, and it is the fix for the WORSE bug of one
 * conversation's draft leaking into another. It also meant switching
 * conversations unmounted the composer and took the draft with it: mid-message
 * to Alice, you click Bob to check something she asked about, and your
 * paragraph is gone.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { saveDraft, loadDraft, clearDraft, clearAllDraftsForTests } from '../draft-store';

describe('conversation drafts', () => {
  beforeEach(clearAllDraftsForTests);

  it('survives leaving a conversation and coming back', () => {
    saveDraft('alice', 'half a thought');
    expect(loadDraft('alice')).toBe('half a thought');
  });

  it('does not leak between conversations', () => {
    // The bug the keyed remount exists to prevent. Keeping drafts must not
    // reintroduce it.
    saveDraft('alice', 'for alice');
    expect(loadDraft('bob')).toBe('');
  });

  it('treats an empty box as no draft', () => {
    // Otherwise clearing the composer and leaving would restore the text on
    // return — the box refilling itself after you emptied it.
    saveDraft('alice', 'typed');
    saveDraft('alice', '');
    expect(loadDraft('alice')).toBe('');
  });

  it('forgets a draft on request', () => {
    saveDraft('alice', 'typed');
    clearDraft('alice');
    expect(loadDraft('alice')).toBe('');
  });

  it('reads an untouched conversation as empty, not undefined', () => {
    // The composer seeds its state from this; undefined would make it an
    // uncontrolled input and React would warn on the first keystroke.
    expect(loadDraft('never-typed')).toBe('');
  });

  it('keeps whitespace, which a user may have meant', () => {
    saveDraft('alice', '  ');
    expect(loadDraft('alice')).toBe('  ');
  });
});
