/**
 * `hasPermission` returns `false` for a cache MISS, and every caller that
 * renders a denial needs to know the difference.
 *
 * A three-user office run told all three users "You do not have permission to
 * send messages here" and took their composer away: the office chat gated on
 * `SendMessages`, and the answer for that domain had never been stored. Nothing
 * at the call site could tell that from a real refusal.
 *
 * `hasAnswerFor` is that difference, and it is about the whole INHERITANCE
 * CHAIN. `hasPermission` denies on a domain's own entry and only then falls back
 * to the workspace root, so a node that grants nothing while the root has never
 * been fetched produces a definite-looking refusal for a permission the root may
 * confer. CI showed that too: an office composer replaced by "You do not have
 * permission to send messages here" for a user whose role grants it.
 */
import { describe, it, expect } from 'vitest';
import { hasAnswerFor, hasPermission } from '../cache';
import { Permission, type DomainPermissions } from '../types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

function entry(permissions: Permission[]): DomainPermissions {
  return { role: null, permissions: new Set(permissions) } as unknown as DomainPermissions;
}

describe('whether an answer exists', () => {
  it('is false for a cache nobody has filled', () => {
    const cache: Map<string, DomainPermissions> = new Map();
    expect(hasAnswerFor(cache, 'node-1')).toBe(false);

    // The whole point: the permission check says the same thing here as it does
    // for a real refusal.
    expect(hasPermission(cache, 'node-1', Permission.SendMessages)).toBe(false);
  });

  it('is not satisfied by the domain alone, because the root can still grant it', () => {
    // The node answered and granted nothing; the root has never been fetched.
    // `hasPermission` says false, and that false is not yet a fact.
    const cache: Map<string, DomainPermissions> = new Map([['node-1', entry([])]]);

    expect(hasPermission(cache, 'node-1', Permission.SendMessages)).toBe(false);
    expect(hasAnswerFor(cache, 'node-1')).toBe(false);
  });

  it('is true once the chain has answered', () => {
    // The positive control: a version returning false always would satisfy
    // every test above and make every permission unenforceable.
    const cache: Map<string, DomainPermissions> = new Map([
      ['node-1', entry([])],
      [WORKSPACE_ROOT_ID, entry([])],
    ]);
    expect(hasAnswerFor(cache, 'node-1')).toBe(true);

    // And an answer that grants nothing, with nothing above it to inherit from,
    // is a real denial.
    expect(hasPermission(cache, 'node-1', Permission.SendMessages)).toBe(false);
  });

  it('counts the workspace root, because the permission check falls back to it', () => {
    const cache: Map<string, DomainPermissions> = new Map([
      [WORKSPACE_ROOT_ID, entry([Permission.SendMessages])],
    ]);
    expect(hasAnswerFor(cache, 'node-1')).toBe(true);
    expect(hasPermission(cache, 'node-1', Permission.SendMessages)).toBe(true);
  });
});
