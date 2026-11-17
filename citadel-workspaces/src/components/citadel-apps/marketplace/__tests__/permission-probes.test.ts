/**
 * The marketplace's permission answers: every permission it consults is probed, and a pair that was
 * not probed reads as not known -- never as a refusal, never as a grant.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from 'citadel-workspace-client-ts';
import { Permission } from '@/lib/permissions-service/types';
import { CAPABILITY_COPY } from '@/lib/citadel-apps/capability-copy';
import type { Authority } from '@/lib/citadel-apps/scope-options';
import { authorityFrom, MARKETPLACE_PERMISSIONS, probeKey } from '../PermissionProbes';

describe('the permission probes', () => {
  it('cover the install and manage grants and every capability’s installer permission', () => {
    for (const p of [Permission.AppManage, Permission.AppInstall, Permission.AppInstallScoped, Permission.UpdateNodeSettings]) {
      expect(MARKETPLACE_PERMISSIONS).toContain(p);
    }
    for (const cap of Object.keys(CAPABILITY_COPY) as Capability[]) {
      expect(MARKETPLACE_PERMISSIONS).toContain(CAPABILITY_COPY[cap].installerNeeds);
    }
    expect(new Set(MARKETPLACE_PERMISSIONS).size).toBe(MARKETPLACE_PERMISSIONS.length);
  });

  it('read an answer for the pair asked; control: any other pair is not known', () => {
    const authority: Authority = authorityFrom(new Map([[probeKey(Permission.AppInstall, 'root'), 'no']]));
    expect(authority.holds(Permission.AppInstall, 'root')).toBe('no');
    expect(authority.holds(Permission.AppInstall, 'n-1')).toBe('unknown');
    expect(authority.holds(Permission.AppManage, 'root')).toBe('unknown');
  });
});
