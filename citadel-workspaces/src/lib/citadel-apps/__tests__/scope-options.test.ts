/**
 * The scope picker's choices: each offered only when the app supports it, the page exists and the
 * person holds what the kernel would ask; otherwise disabled with its reason. Every refusal sits
 * beside the same choice offered once the one missing thing is there.
 */
import { describe, expect, it } from 'vitest';
import type { AppAudience } from 'citadel-workspace-client-ts';
import { Permission } from '@/lib/permissions-service/types';
import { installScopeOf, scopeDomain, scopeOption, scopeOptions, type Authority, type ScopeContext, type ScopeOption, type Tri } from '../scope-options';

const ROOT: string = 'workspace-root';
const holding = (held: ReadonlyArray<string>, unknown: ReadonlyArray<string> = []): Authority => ({
  holds: (p: Permission, domain: string): Tri => (unknown.includes(`${p}@${domain}`) ? 'unknown' : held.includes(`${p}@${domain}`) || held.includes(p) ? 'yes' : 'no'),
});
const ctx = (over: Partial<ScopeContext> = {}): ScopeContext => ({
  scopes: ['workspace', 'node', 'node_tree', 'users', 'self'], audience: { kind: 'global' }, nodeId: 'n-1', rootId: ROOT,
  authority: holding(['AppInstall', 'AppInstallScoped', 'UpdateNodeSettings']), ...over,
});

describe('the scope choices', () => {
  it('offers every choice to someone who holds everything', () => {
    expect(scopeOptions(ctx()).every((o) => o.enabled && o.reason === null)).toBe(true);
  });

  it('Just for me needs AppInstall; control: offered with it', () => {
    const off: ScopeOption = scopeOption('self', ctx({ authority: holding([]) }));
    expect(off).toEqual({ choice: 'self', enabled: false, reason: 'You need “Install apps for yourself”. Ask a workspace admin.' });
    expect(scopeOption('self', ctx({ authority: holding(['AppInstall']) })).enabled).toBe(true);
  });

  it('the wider choices need AppInstallScoped; control: offered with it', () => {
    const member: Authority = holding(['AppInstall', 'UpdateNodeSettings']);
    for (const c of ['workspace', 'node', 'node_tree', 'users'] as const) {
      expect(scopeOption(c, ctx({ authority: member })).reason).toBe('You need “Install apps for others”. Ask a workspace admin.');
    }
    expect(scopeOption('users', ctx({ authority: holding(['AppInstallScoped']) })).enabled).toBe(true);
  });

  it('a page install needs authority over that page; control: the page grant suffices', () => {
    const noNode: Authority = holding(['AppInstallScoped', `UpdateNodeSettings@${ROOT}`]);
    expect(scopeOption('node', ctx({ authority: noNode })).reason).toContain('Update office and room settings');
    expect(scopeOption('node', ctx({ authority: holding(['AppInstallScoped', 'UpdateNodeSettings@n-1']) })).enabled).toBe(true);
  });

  it('a choice the app does not support is not offered', () => {
    expect(scopeOption('workspace', ctx({ scopes: ['self'] })).reason).toBe('This app cannot be installed this way.');
  });

  it('a page choice needs a page', () => {
    expect(scopeOption('node_tree', ctx({ nodeId: null })).reason).toBe('Open a page first to install the app there.');
  });

  it('an app for some people cannot be installed for everyone; control: a page install is still offered', () => {
    const some: AppAudience = { kind: 'members', usernames: ['alice'] };
    expect(scopeOption('workspace', ctx({ audience: some })).enabled).toBe(false);
    expect(scopeOption('node', ctx({ audience: some })).enabled).toBe(true);
  });

  it('a permission not yet known is not a refusal and not a grant', () => {
    const o: ScopeOption = scopeOption('self', ctx({ authority: holding([], [`AppInstall@${ROOT}`]) }));
    expect(o).toEqual({ choice: 'self', enabled: false, reason: 'Checking your permissions…' });
  });
});

describe('the install scope a choice stands for', () => {
  it('maps each choice, and refuses one missing what it names', () => {
    expect(installScopeOf('self', 'alice', null, [])).toEqual({ SelfOnly: 'alice' });
    expect(installScopeOf('workspace', 'alice', null, [])).toBe('Workspace');
    expect(installScopeOf('node', 'alice', 'n-1', [])).toEqual({ Node: 'n-1' });
    expect(installScopeOf('node_tree', 'alice', null, [])).toBeNull();
    expect(installScopeOf('users', 'alice', null, ['bob', 'bob', 'carol'])).toEqual({ Users: ['bob', 'carol'] });
    expect(installScopeOf('users', 'alice', null, [])).toBeNull();
  });

  it('the domain that decides grants is the page for page scopes and the root otherwise', () => {
    expect(scopeDomain({ NodeTree: 'n-2' }, ROOT)).toBe('n-2');
    expect(scopeDomain({ Users: ['bob'] }, ROOT)).toBe(ROOT);
  });
});
