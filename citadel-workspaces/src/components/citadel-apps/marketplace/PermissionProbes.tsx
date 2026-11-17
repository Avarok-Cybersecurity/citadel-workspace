/**
 * What the marketplace may offer, asked through `usePermission` -- with its fetch, retry and "never
 * answered" state -- for each permission it reads, on each domain it reads it on. One probe per
 * pair, so the hooks run in a fixed order; each reports a known yes, a known no, or not known yet.
 */
import { useEffect } from 'react';
import { usePermission } from '@/hooks/use-permission';
import { confirms, permits } from '@/hooks/use-permission-result';
import { Permission } from '@/lib/permissions-service/types';
import { CAPABILITY_COPY } from '@/lib/citadel-apps/capability-copy';
import type { Authority, Tri } from '@/lib/citadel-apps/scope-options';

/** Every permission the marketplace consults: the install and manage grants and each capability's. */
export const MARKETPLACE_PERMISSIONS: readonly Permission[] = [...new Set<Permission>([
  Permission.AppManage, Permission.AppInstall, Permission.AppInstallScoped, Permission.UpdateNodeSettings,
  ...Object.values(CAPABILITY_COPY).map((c: { installerNeeds: Permission }) => c.installerNeeds),
])];

export type ProbeAnswers = ReadonlyMap<string, Tri>;
export type OnProbeAnswer = (permission: Permission, domain: string, answer: Tri) => void;

export const probeKey = (permission: Permission, domain: string): string => `${permission}@${domain}`;

/** The probes' answers as the marketplace reads them; a pair not probed is not known. */
export function authorityFrom(answers: ProbeAnswers): Authority {
  return { holds: (permission: Permission, domain: string): Tri => answers.get(probeKey(permission, domain)) ?? 'unknown' };
}

function PermissionProbe({ domain, permission, onAnswer }: { domain: string; permission: Permission; onAnswer: OnProbeAnswer }): null {
  const result: ReturnType<typeof usePermission> = usePermission(domain, permission);
  const answer: Tri = confirms(result) ? 'yes' : permits(result) ? 'unknown' : 'no';
  useEffect(() => { onAnswer(permission, domain, answer); }, [onAnswer, permission, domain, answer]);
  return null;
}

export function PermissionProbes({ domains, onAnswer }: { domains: readonly string[]; onAnswer: OnProbeAnswer }): JSX.Element {
  return (
    <>
      {[...new Set(domains)].flatMap((domain: string) => MARKETPLACE_PERMISSIONS.map((permission: Permission) => (
        <PermissionProbe key={probeKey(permission, domain)} domain={domain} permission={permission} onAnswer={onAnswer} />
      )))}
    </>
  );
}
