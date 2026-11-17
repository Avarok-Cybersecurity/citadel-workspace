/**
 * Settings -> Security -> Secure links: the links you made, how many more you may make, and
 * Extend, Regenerate (confirmed; the new link shown once) and Delete (confirmed) on each.
 */
import { useState } from 'react';
import { Link2 } from 'lucide-react';
import type { RoleDefinition, SecureLinkInfo, WorkspaceRoles } from 'citadel-workspace-client-ts';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import { useRoleTable } from '@/hooks/use-workspace-roles';
import { secureLinksApi } from '@/lib/share/secure-links-api';
import { atLimit, LIMIT_COPY } from '@/lib/share/link-lifetime';
import type { TabIdentity } from '@/lib/tab-identity';
import { LinkField } from './LinkField';
import { QuotaMeter } from './QuotaMeter';
import { SecureLinkRow } from './SecureLinkRow';
import { SECURE_COPY } from './SecureLinkPanel';
import { useSecureLinks, type SecureLinks } from './use-secure-links';

type Confirming = { action: 'regenerate' | 'delete'; link: SecureLinkInfo } | null;

const CONFIRM_COPY: Record<'regenerate' | 'delete', { title: string; body: string; button: string }> = {
  regenerate: { title: 'Make a new link?', body: 'The current link stops working at once. Anyone you sent it to will need the new one.', button: 'Regenerate' },
  delete: { title: 'Delete this link?', body: 'It stops working at once, for everyone, and frees one of your secure links.', button: 'Delete' },
};

function Header(): JSX.Element {
  return (
    <>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <Link2 className="h-4 w-4 text-primary-accent" aria-hidden="true" />Secure links
      </div>
      <p className="text-xs text-muted-foreground">Links you made that hide where they point. Each opens only for the people you chose, until it expires.</p>
    </>
  );
}

/** The list, the meter and the confirmations, drawn from `links` (use-secure-links.ts). */
export function SecureLinksList({ links, roleName }: { links: SecureLinks; roleName: (id: string) => string }): JSX.Element {
  const [confirming, setConfirming] = useState<Confirming>(null);
  const { state, busy, fresh } = links;
  const now: number = Date.now();

  return (
    <>
      {state.kind === 'loading' && <p className="text-xs text-muted-foreground">Loading your secure links…</p>}
      {state.kind === 'failed' && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-background/50 p-3">
          <p className="text-xs text-muted-foreground">{`Your secure links could not be read: ${state.message}`}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void links.reload()}>Try again</Button>
        </div>
      )}
      {state.kind === 'loaded' && (<>
        <QuotaMeter quota={state.quota} testId="security-links-quota" />
        {atLimit(state.quota) && <p className="text-xs text-muted-foreground" data-testid="security-links-limit">{`${LIMIT_COPY.reached} ${LIMIT_COPY.admins}`}</p>}
        {fresh !== null && (
          <div className="space-y-2 rounded-lg border border-warning/40 p-3" data-testid="security-links-fresh">
            <LinkField url={fresh.url} label="New secure link" testId="security-links-fresh-link" />
            <p className="text-xs text-warning-emphasis">{SECURE_COPY.shownOnce}</p>
            <Button type="button" size="sm" variant="ghost" onClick={links.dismissFresh}>Done</Button>
          </div>
        )}
        {state.links.length === 0
          ? <p className="text-xs text-muted-foreground" data-testid="security-links-empty">You have no secure links. Make one from any Share menu.</p>
          : (
            <ul className="space-y-2" aria-label="Your secure links">
              {state.links.map((link: SecureLinkInfo) => (
                <SecureLinkRow key={link.id} link={link} nowMs={now} roleName={roleName} busy={busy}
                  onExtend={(preset) => void links.extend(link.id, preset)}
                  onRegenerate={() => setConfirming({ action: 'regenerate', link })}
                  onDelete={() => setConfirming({ action: 'delete', link })} />
              ))}
            </ul>
          )}
      </>)}
      <AlertDialog open={confirming !== null} onOpenChange={(open: boolean) => { if (!open) setConfirming(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming ? CONFIRM_COPY[confirming.action].title : ''}</AlertDialogTitle>
            <AlertDialogDescription>{confirming ? `“${confirming.link.label}”. ${CONFIRM_COPY[confirming.action].body}` : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="confirm-secure-link-action" onClick={() => {
              if (confirming) void (confirming.action === 'delete' ? links.remove(confirming.link.id) : links.regenerate(confirming.link.id));
              setConfirming(null);
            }}>
              {confirming ? CONFIRM_COPY[confirming.action].button : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground" data-testid="security-links-status">{links.message ?? ''}</p>
    </>
  );
}

function Connected({ server }: { server: string }): JSX.Element {
  const links: SecureLinks = useSecureLinks(secureLinksApi, window.location.origin, server);
  const table: WorkspaceRoles | null = useRoleTable();
  const roleName = (id: string): string => table?.roles.find((r: RoleDefinition) => r.id === id)?.name ?? id;
  return (
    <>
      <SecureLinksList links={links} roleName={roleName} />
    </>
  );
}

export function SecureLinksSection(): JSX.Element {
  const identity: TabIdentity | null = useTabIdentity();
  const server: string | null = identity?.serverAddress ?? null;
  return (
    <section className="space-y-3" data-testid="secure-links-section" aria-label="Secure links">
      <Header />
      {server === null || !secureLinksApi.ready()
        ? <p className="text-xs text-muted-foreground" data-testid="security-links-signed-out">Sign in to a workspace to see and manage your secure links.</p>
        : <Connected server={server} />}
    </section>
  );
}
