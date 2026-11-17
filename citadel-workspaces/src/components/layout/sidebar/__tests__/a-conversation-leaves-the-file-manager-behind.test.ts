/**
 * Opening a conversation from the file manager leaves all of it behind: the
 * section, and every key it wrote. A key left over reopened the last folder the
 * next time the file manager was shown, and rode along in every link copied.
 *
 * The keys are read from a link the file manager itself wrote, not from the list
 * that clears them: checking a list against itself passes whatever it leaves out.
 */
import { describe, it, expect } from 'vitest';
import { conversationHref } from '../active-conversation';
import { fileManagerHref } from '@/lib/file-manager-location';

describe('a conversation opened from the file manager', () => {
  it('carries none of the file manager\'s keys', () => {
    const fileManager: string = fileManagerHref('', { storage: { kind: 'peer', cid: 42n }, path: '/Docs', item: 'a.pdf', via: 7n });
    const search: string = `?${fileManager.split('?')[1]}`;
    const written: string[] = [...new URLSearchParams(search).keys()];
    expect(written).toEqual(expect.arrayContaining(['section', 'peer_id', 'path', 'item', 'via']));

    const href: string = conversationHref('/workspace', search, { cid: '42', username: 'bob' });
    const params: URLSearchParams = new URLSearchParams(href.split('?')[1]);
    for (const key of written) expect(params.has(key), key).toBe(false);
    expect(params.get('channel')).toBe('42');
  });
});
