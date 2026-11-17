/**
 * Share: a plain link to each item, or one secure link that hides where it points.
 *
 * The dialog every share and copy-link action opens (file manager, sidebar nodes, the page
 * header, both chat headers). Secure needs ShareSecureLinks, and is made for one item at a time;
 * where it cannot be made the choice says why rather than disappearing.
 */
import { useMemo, useState } from 'react';
import type { RoleDefinition } from 'citadel-workspace-client-ts';
import { LazySettingsModal } from '@/components/LazySettingsModal';
import { usePermission } from '@/hooks/use-permission';
import { confirms, gateOnKnownAnswer, permits, type ActionGate, type UsePermissionResult } from '@/hooks/use-permission-result';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import { useDomainMembers } from '@/hooks/use-domain-members';
import { useRoleTable } from '@/hooks/use-workspace-roles';
import { Permission } from '@/lib/permissions-service/types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { secureLinksApi } from '@/lib/share/secure-links-api';
import { shareTarget, type ShareSubject, type ShareTarget, type ShareViewer } from '@/lib/share/share-target';
import type { TabIdentity } from '@/lib/tab-identity';
import { SecureLinkPanel } from './SecureLinkPanel';
import { ShareLinkDialogView } from './ShareLinkDialogView';
import type { ShareMode } from './ShareModeChoice';
import { useShareLinkFlow, type ShareLinkFlow } from './use-share-link-flow';
import type { RoleOption } from './GrantBuilder';

export const SHARE_COPY: { noPermission: string; oneAtATime: string; noServer: string } = {
  noPermission: "Your role can't make secure links. An admin can grant “Share secure links”.",
  oneAtATime: 'Secure links are made one item at a time. Share a single item to make one.',
  noServer: 'This session has not said which workspace it is on yet. Try again in a moment.',
};

/** What a plain link opens, said for the things being shared. */
export function plainNoteOf(subjects: readonly ShareSubject[]): string {
  const files: ShareSubject[] = subjects.filter((s: ShareSubject) => s.kind === 'file' || s.kind === 'folder');
  if (files.length === 0) return 'Anyone with the link sees where it points, and opens it if they can already see it.';
  const peer: string | null = files[0].kind === 'file' || files[0].kind === 'folder' ? files[0].peer : null;
  return peer !== null
    ? `These links open in the storage you share with ${peer}, for you and for them.`
    : 'These links open the same place in the reader’s own server storage.';
}

function viewerOf(identity: TabIdentity | null): ShareViewer | null {
  return identity?.cid !== undefined && identity.username ? { cid: identity.cid, username: identity.username } : null;
}

function SecureShare({ target, server, me, onManageLinks }: { target: ShareTarget; server: string; me: string; onManageLinks: () => void }): JSX.Element {
  const flow: ShareLinkFlow = useShareLinkFlow(target, { api: secureLinksApi, origin: window.location.origin, server });
  const members: string[] = useDomainMembers(WORKSPACE_ROOT_ID).members.map((m) => m.username).filter((u: string) => u !== me);
  const roles: RoleOption[] = (useRoleTable()?.roles ?? []).map((r: RoleDefinition) => ({ id: r.id, name: r.name }));
  const isAdmin: boolean = confirms(usePermission(WORKSPACE_ROOT_ID, Permission.ManageRoles));
  return <SecureLinkPanel flow={flow} target={target} members={members} roles={roles} isAdmin={isAdmin} onManageLinks={onManageLinks} />;
}

/** Why Secure cannot be chosen here, or null when it can. */
export function secureUnavailableOf(gate: ActionGate, count: number, server: string | null): string | null {
  if (count !== 1) return SHARE_COPY.oneAtATime;
  if (!gate.enabled) return gate.reason;
  return server === null ? SHARE_COPY.noServer : null;
}

function OpenShareDialog({ subjects, onClose }: { subjects: readonly ShareSubject[]; onClose: () => void }): JSX.Element {
  const identity: TabIdentity | null = useTabIdentity();
  const viewer: ShareViewer | null = viewerOf(identity);
  const server: string | null = identity?.serverAddress ?? null;
  // Creating is refused by the server on a no, so Secure waits for a known yes (gateOnKnownAnswer);
  // a known no is said in this dialog's words rather than the generic edit refusal.
  const answer: UsePermissionResult = usePermission(WORKSPACE_ROOT_ID, Permission.ShareSecureLinks);
  const gate: ActionGate = permits(answer) ? gateOnKnownAnswer(answer) : { enabled: false, reason: SHARE_COPY.noPermission };
  const [mode, setMode] = useState<ShareMode>('plain');
  const [managing, setManaging] = useState<boolean>(false);

  const targets: ShareTarget[] = useMemo((): ShareTarget[] => subjects.flatMap((s: ShareSubject): ShareTarget[] => {
    const t: ShareTarget | null = shareTarget(s, viewerOf(identity));
    return t === null ? [] : [t];
  }), [subjects, identity]);
  const unavailable: string | null = secureUnavailableOf(gate, subjects.length, server);
  const secure: JSX.Element | null = mode === 'secure' && unavailable === null && targets.length === 1 && server !== null && viewer !== null
    ? <SecureShare key={targets[0].href} target={targets[0]} server={server} me={viewer.username} onManageLinks={() => setManaging(true)} />
    : null;

  return (
    <>
      <ShareLinkDialogView
        open={!managing}
        onClose={onClose}
        targets={targets}
        plainLinks={targets.map((t: ShareTarget) => ({ target: t, url: `${window.location.origin}${t.href}` }))}
        plainNote={plainNoteOf(subjects)}
        mode={unavailable === null ? mode : 'plain'}
        onMode={setMode}
        secureUnavailable={unavailable}
        secure={secure}
      />
      {managing && <LazySettingsModal open onOpenChange={(open: boolean) => { if (!open) onClose(); }} tab="security" />}
    </>
  );
}

/** Closed while `subjects` is null; open on them otherwise. Each opening starts afresh. */
export function ShareLinkDialog({ subjects, onClose }: { subjects: readonly ShareSubject[] | null; onClose: () => void }): JSX.Element | null {
  return subjects === null || subjects.length === 0 ? null : <OpenShareDialog subjects={subjects} onClose={onClose} />;
}
