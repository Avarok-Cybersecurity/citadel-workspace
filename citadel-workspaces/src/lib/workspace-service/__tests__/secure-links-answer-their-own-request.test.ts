/**
 * The secure-link requests: each sends its own shape and resolves with ITS answer -- the kind
 * that fits, about the link it named -- skipping answers that are not. A refusal rejects.
 * Doubled: the wire (the sender) and the inbound event, as every write-gate test here does.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SecureLinkInfo } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import {
  createSecureLink, deleteSecureLink, extendSecureLink, listSecureLinks, regenerateSecureLink, resolveSecureLink,
  type NewSecureLink,
} from '../secure-links-operations';
import type { ProtocolSender } from '../workspace-operations';

type Sender = ProtocolSender & { sent: WorkspaceProtocolRequestTS[] };

function sender(answers: unknown[]): Sender {
  const sent: WorkspaceProtocolRequestTS[] = [];
  return {
    sent, currentCid: 7n,
    sendProtocolRequest: vi.fn(async (request: WorkspaceProtocolRequestTS): Promise<void> => {
      sent.push(request);
      for (const a of answers) setTimeout(() => eventEmitter.emit('workspace:raw-response', a), 0);
    }),
  };
}

const info = (id: string, target: string = '/messages'): SecureLinkInfo => ({
  id, target, label: 'x', grants: ['Workspace'], one_time: false, created_ms: 1n, expires_ms: 2n, uses: 0, last_used_ms: null,
});

describe('secure-link requests', () => {
  it('List resolves with the links and the quota', async () => {
    const s: Sender = sender([{ SecureLinks: { Links: { links: [info('a')], live: 1, per_member: 5, pool: 50, pool_used: 3 } } }]);
    expect(await listSecureLinks(s)).toEqual({ links: [info('a')], quota: { live: 1, perMember: 5, pool: 50, poolUsed: 3 } });
    expect(s.sent).toEqual([{ SecureLinks: 'List' }]);
  });

  it('Create sends the target, grants and lifetime, and returns the token once', async () => {
    const s: Sender = sender([{ SecureLinks: { Created: { info: info('a', '/other'), token: 'old' } } }, { SecureLinks: { Created: { info: info('b'), token: 'tok' } } }]);
    const link: NewSecureLink = { target: '/messages', label: 'x', grants: [{ Members: ['bob'] }], lifetime: { OneTime: { ttl_ms: 3600000n } } };
    expect(await createSecureLink(s, link)).toEqual({ kind: 'created', info: info('b'), token: 'tok' });
    expect(s.sent).toEqual([{ SecureLinks: { Create: link } }]);
  });

  it('Create at the limit is an outcome, not a failure', async () => {
    const s: Sender = sender([{ SecureLinks: { LimitReached: { per_member: 5, pool: 0 } } }]);
    expect(await createSecureLink(s, { target: '/messages', label: '', grants: ['Workspace'], lifetime: { Expires: { ttl_ms: 1n } } }))
      .toEqual({ kind: 'limit-reached', perMember: 5, pool: 0 });
  });

  it('Regenerate, Extend and Delete take only the answer about their own link', async () => {
    expect(await regenerateSecureLink(sender([{ SecureLinks: { Regenerated: { info: info('z'), token: 'no' } } }, { SecureLinks: { Regenerated: { info: info('a'), token: 'new' } } }]), 'a'))
      .toEqual({ kind: 'regenerated', info: info('a'), token: 'new' });
    const e: Sender = sender([{ SecureLinks: { Extended: { info: info('a') } } }]);
    expect(await extendSecureLink(e, 'a', 86400000n)).toEqual({ kind: 'extended', info: info('a') });
    expect(e.sent).toEqual([{ SecureLinks: { Extend: { id: 'a', ttl_ms: 86400000n } } }]);
    expect(await deleteSecureLink(sender([{ SecureLinks: { Deleted: { id: 'z' } } }, { SecureLinks: { Deleted: { id: 'a' } } }]), 'a')).toEqual({ kind: 'deleted' });
  });

  it('LinkUnavailable is the one answer for a link that is gone or not yours', async () => {
    expect(await deleteSecureLink(sender([{ SecureLinks: 'LinkUnavailable' }]), 'a')).toEqual({ kind: 'unavailable' });
    expect(await resolveSecureLink(sender([{ SecureLinks: 'LinkUnavailable' }]), 't')).toEqual({ kind: 'unavailable' });
  });

  it('Resolve sends the token and returns the target', async () => {
    const s: Sender = sender([{ SecureLinks: { Resolved: { target: '/groups/g' } } }]);
    expect(await resolveSecureLink(s, 'tok')).toEqual({ kind: 'resolved', target: '/groups/g' });
    expect(s.sent).toEqual([{ SecureLinks: { Resolve: { token: 'tok' } } }]);
  });

  it('a refusal in words rejects', async () => {
    await expect(listSecureLinks(sender([{ Error: 'Permission denied: ShareSecureLinks required' }]))).rejects.toThrow('ShareSecureLinks');
  });
});
