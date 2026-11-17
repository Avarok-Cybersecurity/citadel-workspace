/**
 * Clicking a member you are not registered with opens the conversation anyway (owner,
 * 2026-10-15); the chat then offers the connect request. The CID comes from the contact, else
 * from the agent's listing; only someone neither knows is unaddressable, and your own row is inert.
 */
import { describe, it, expect } from 'vitest';
import { memberChatTarget } from '../member-chat-target';
import type { RegisteredPeer } from '@/hooks/use-registered-peers';

const CONTACTS: RegisteredPeer[] = [{ cid: '11', username: 'thomas' } as RegisteredPeer];
const LISTED: Record<string, bigint> = { colleague: 22n, thomas: 99n };
const listed = (username: string): bigint | undefined => LISTED[username];

describe('where a member row goes', () => {
  it('opens a non-contact\'s chat by the CID the agent lists', () => {
    expect(memberChatTarget('colleague', 'me', CONTACTS, listed)).toEqual({ kind: 'conversation', cid: 22n });
  });

  it('prefers the contact\'s own CID', () => {
    expect(memberChatTarget('thomas', 'me', CONTACTS, listed)).toEqual({ kind: 'conversation', cid: 11n });
  });

  it('says a never-listed member is unreachable, and opens nothing on your own row', () => {
    expect(memberChatTarget('ghost', 'me', CONTACTS, listed)).toEqual({ kind: 'unreachable' });
    expect(memberChatTarget('me', 'me', CONTACTS, listed)).toBeNull();
  });
});
