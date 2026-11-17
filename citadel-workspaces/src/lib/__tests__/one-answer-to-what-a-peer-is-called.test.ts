/**
 * One module decides how a peer is named — and it has to know what a name isn't.
 *
 * `peer-display.ts` was written so "every surface answers the question
 * identically", and its docstring names the rendering it exists to abolish:
 * `User 70409342`, the first eight decimal digits of a CID.
 *
 * Two things had gone wrong since.
 *
 * 1. Four sites hand-rolled their own handle anyway — the conversation list and
 *    the registered-peer list from the LAST six digits, the message
 *    notification from the FIRST eight. The same peer was named three different
 *    ways depending on which surface you were looking at.
 *
 * 2. The pipeline fills the username field with placeholders ('Unknown',
 *    'User 7040934', 'Loading...'), and five sites hand-rolled their own idea
 *    of which strings those were, using three different definitions. None
 *    covered all of them. A peer called 'User 12345' was a placeholder to the
 *    registration service and a real name to the sidebar — so the placeholder
 *    was preserved in preference to the real name arriving behind it, forever.
 *
 * The authority now answers both questions.
 */
import { describe, it, expect } from 'vitest';
import {
  isPlaceholderName,
  peerDisplayName,
  peerInitials,
  isUnnamedPeer,
} from '../peer-display';

const CID: bigint = 70409342001234n;

describe('what counts as a name a person chose', () => {
  it('rejects every placeholder the pipeline invents', () => {
    for (const invented of [
      'Unknown',
      'Unknown Peer',
      'Unknown peer',
      'Unknown User',
      'Loading...',
      'User 70409342',
      'User 1',
      'Peer 4F2A1C',
      '',
      '   ',
    ]) {
      expect(isPlaceholderName(invented), invented).toBe(true);
    }
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName(undefined)).toBe(true);
  });

  it('accepts names that merely resemble one', () => {
    // The positive control. A predicate that answered `true` to everything
    // would pass the test above and erase every real username in the app.
    for (const real of [
      'alice',
      'Unknown Quantity',
      'Userbert',
      'Peerless',
      'User',
      'Peer Gynt',
      'loading',
      'user_1234',
    ]) {
      expect(isPlaceholderName(real), real).toBe(false);
    }
  });
});

describe('the name shown for a peer', () => {
  it('prefers a chosen name, and never shows a placeholder as one', () => {
    expect(peerDisplayName({ cid: CID, fullName: 'Alice Adams', username: 'alice' })).toBe('Alice Adams');
    expect(peerDisplayName({ cid: CID, username: 'alice' })).toBe('alice');

    // Each of these used to render verbatim as somebody's name.
    for (const invented of ['Unknown', 'User 70409342', 'Loading...']) {
      const shown: string = peerDisplayName({ cid: CID, username: invented });
      expect(shown).not.toBe(invented);
      expect(shown.startsWith('Peer ')).toBe(true);
    }
  });

  it('gives the same peer the same name at every surface', () => {
    // The three hand-rolled variants disagreed by construction: last six
    // decimal digits, first eight decimal digits, and this handle.
    const fromConversationList: string = peerDisplayName({ cid: CID });
    const fromPeerList: string = peerDisplayName({ cid: String(CID) });
    const fromNotification: string = peerDisplayName({ cid: CID, username: 'Unknown' });
    expect(fromPeerList).toBe(fromConversationList);
    expect(fromNotification).toBe(fromConversationList);
  });

  it('says so when it has nothing to work with', () => {
    expect(peerDisplayName({ cid: undefined })).toBe('Unknown peer');
    expect(peerDisplayName({ cid: 0n })).toBe('Unknown peer');
  });
});

describe('the other two answers move with it', () => {
  it('treats a placeholder as unnamed', () => {
    expect(isUnnamedPeer({ cid: CID, username: 'alice' })).toBe(false);
    expect(isUnnamedPeer({ cid: CID, username: 'User 70409342' })).toBe(true);
    expect(isUnnamedPeer({ cid: CID, fullName: 'Unknown', username: 'Loading...' })).toBe(true);
  });

  it('does not take an initial from a placeholder', () => {
    expect(peerInitials({ cid: CID, username: 'alice' })).toBe('A');
    // Was 'U', for every unnamed peer in the app at once.
    expect(peerInitials({ cid: CID, username: 'Unknown' })).not.toBe('U');
  });
});
