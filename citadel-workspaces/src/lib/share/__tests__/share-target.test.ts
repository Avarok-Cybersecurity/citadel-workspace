/**
 * One description of every shareable thing: each kind's in-app href comes from the builder the
 * app navigates with, passes the server's target rules, reads back as its own kind, and carries
 * the default grant the plan names.
 */
import { describe, expect, it } from 'vitest';
import { parseFileManagerLocation } from '@/lib/file-manager-location';
import { activeConversation } from '@/components/layout/sidebar/active-conversation';
import { shareTarget, kindOfTarget, validateShareTarget, type ShareSubject, type ShareTarget, type ShareViewer } from '../share-target';

const ME: ShareViewer = { cid: 42n, username: 'alice' };
function at(s: ShareSubject): ShareTarget {
  const t: ShareTarget | null = shareTarget(s, ME);
  if (t === null) throw new Error('no target');
  return t;
}
const query = (href: string): URLSearchParams => new URLSearchParams(href.slice(href.indexOf('?')));

describe('share targets', () => {
  it('a file in peer storage opens the file manager at its folder and item, for the peer', () => {
    const t: ShareTarget = at({ kind: 'file', name: 'q3 plan.pdf', peer: 'bob', location: { storage: { kind: 'peer', cid: 7n }, path: '/Docs', item: 'q3 plan.pdf', via: 42n } });
    expect(t.href.startsWith('/workspace?')).toBe(true);
    expect(parseFileManagerLocation(query(t.href))).toEqual({ storage: { kind: 'peer', cid: 7n }, path: '/Docs', item: 'q3 plan.pdf', via: 42n });
    expect(t.defaultGrant).toEqual({ Members: ['bob'] });
    expect(kindOfTarget(t.href)).toBe('file');
  });

  it('a folder in server storage is for everyone in the workspace by default', () => {
    const t: ShareTarget = at({ kind: 'folder', name: 'Docs', peer: null, location: { storage: { kind: 'server' }, path: '/Docs', item: null, via: null } });
    expect(parseFileManagerLocation(query(t.href)).path).toBe('/Docs');
    expect(t.defaultGrant).toBe('Workspace');
    expect(kindOfTarget(t.href)).toBe('folder');
  });

  it('a node opens by nodeId and defaults to the people who can see it', () => {
    const t: ShareTarget = at({ kind: 'node', nodeId: 'office-1', name: 'Design' });
    expect(t.href).toBe('/workspace?nodeId=office-1');
    expect(t.defaultGrant).toEqual({ NodeViewers: 'office-1' });
    expect(t.nodeId).toBe('office-1');
    expect(kindOfTarget(t.href)).toBe('node');
  });

  it("a peer chat opens, for the peer, their conversation with the sharer", () => {
    const t: ShareTarget = at({ kind: 'peer-chat', peerUsername: 'bob', peerName: 'Bob' });
    expect(activeConversation('/workspace', t.href.slice('/workspace'.length))).toEqual({ peerCid: '42', groupId: null });
    expect(query(t.href).get('p2pUser')).toBe('alice');
    expect(t.defaultGrant).toEqual({ Members: ['bob'] });
    expect(kindOfTarget(t.href)).toBe('peer-chat');
  });

  it('a group chat opens /groups/<id> and defaults to its members as of now', () => {
    const t: ShareTarget = at({ kind: 'group-chat', groupId: 'g-1', name: 'Ops', members: ['alice', 'bob'] });
    expect(t.href).toBe('/groups/g-1');
    expect(t.defaultGrant).toEqual({ GroupSnapshot: { group_id: 'g-1', members: ['alice', 'bob'] } });
    expect(kindOfTarget(t.href)).toBe('group-chat');
  });

  it('a peer chat needs the sharer; everything else does not', () => {
    expect(shareTarget({ kind: 'peer-chat', peerUsername: 'bob', peerName: 'Bob' }, null)).toBeNull();
    expect(shareTarget({ kind: 'node', nodeId: 'n', name: 'N' }, null)?.href).toBe('/workspace?nodeId=n');
  });

  it('a group whose roster this member cannot see offers no snapshot', () => {
    const t: ShareTarget = at({ kind: 'group-chat', groupId: 'g-1', name: 'Ops', members: [] });
    expect(t.group).toBeNull();
    expect(t.defaultGrant).toEqual({ Members: [] });
  });

  it('the directory opens at a node or at its top', () => {
    expect(at({ kind: 'directory', nodeId: 'n 1', name: 'People' }).href).toBe('/directory?nodeId=n+1');
    expect(at({ kind: 'directory', nodeId: null, name: 'People' }).href).toBe('/directory');
    expect(kindOfTarget('/directory?nodeId=n+1')).toBe('directory');
  });

  it('every kind passes the server\'s target rules', () => {
    const subjects: ShareSubject[] = [
      { kind: 'file', name: 'ü x', peer: null, location: { storage: { kind: 'server' }, path: '/ü dir', item: 'ü x', via: null } },
      { kind: 'node', nodeId: 'n', name: 'N' },
      { kind: 'peer-chat', peerUsername: 'bob', peerName: 'Bob' },
      { kind: 'group-chat', groupId: 'g', name: 'G', members: ['a'] },
      { kind: 'directory', nodeId: null, name: 'D' },
    ];
    for (const s of subjects) expect(validateShareTarget(at(s).href), at(s).href).toBe(true);
  });
});

describe('the target rules', () => {
  it.each([
    'javascript:alert(1)', 'https://evil.example/workspace', '//evil.example/workspace', '/\\evil.example', '',
    '/workspace?nodeId=a&nodeId=b', '/workspace?nodeId=', '/groups/', '/groups/..', '/groups/a/b', '/settings',
    '/workspace\tx', '/workspace?x= y', `/workspace?${'a'.repeat(2048)}`,
  ])('refuses %j', (target: string) => {
    expect(validateShareTarget(target)).toBe(false);
  });

  it.each(['/workspace', '/messages', '/directory', '/groups/abc-1.2_%20', '/workspace?nodeId=a%20b#x'])('accepts %j', (target: string) => {
    expect(validateShareTarget(target)).toBe(true);
  });
});
