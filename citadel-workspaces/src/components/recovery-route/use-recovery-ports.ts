/**
 * The recovery ports with their real I/O, each one a mechanism the app already has: the settings
 * request store, the sign-in-needed store, the apps modal, the draft store and the guarded
 * navigation, the reload that keeps drafts, the admin ask on the wire.
 */
import { useMemo } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import { useGuardedNavigate, type GuardedNavigate } from '@/hooks/use-guarded-navigate';
import { conversationHref } from '@/components/layout/sidebar/active-conversation';
import { toast } from '@/hooks/use-toast';
import { requestSettings } from '@/lib/settings-request';
import { signInNeededFor } from '@/lib/sessions/sign-in-needed';
import { openAppsModal } from '@/lib/citadel-apps/apps-modal-store';
import { loadDraft, saveDraft } from '@/lib/chat/draft-store';
import { browserSessionStorage, reloadKeepingDrafts } from '@/lib/chat/draft-handoff';
import { requestBugReport } from '@/lib/bug-report/request';
import type { AskOutcome, RecoveryPorts } from '@/lib/recovery-route/ports';
import type { PermissionAsk } from '@/lib/recovery-route/permission-how';
import { describeFailure } from '@/lib/failure-message';
import type { OtherMember } from '@/lib/recovery-route/binding';
import type { AdminRequestKind, BrowserPermission, Destination } from '@/lib/recovery-route/route';

const PATH: { readonly [K in Exclude<Destination, 'apps-browse'>]: string } = { connect: '/connect', home: '/', agent: '/agent' };

const reload = (): void => reloadKeepingDrafts(browserSessionStorage(), (): void => window.location.reload());

async function prompt(media: 'notifications' | 'camera' | 'microphone'): Promise<void> {
  if (media === 'notifications') {
    await Notification.requestPermission();
    return;
  }
  const stream: MediaStream = await navigator.mediaDevices.getUserMedia(media === 'camera' ? { video: true } : { audio: true });
  for (const track of stream.getTracks()) track.stop();
}

/** Loads with the first ask, off the landing path (recovery-ports-ask.ts). */
async function ask(kind: AdminRequestKind, about: string): Promise<AskOutcome> {
  return (await import('./recovery-ports-ask')).askAdmins(kind, about);
}

export function useRecoveryPorts(): RecoveryPorts {
  const navigate: GuardedNavigate = useGuardedNavigate();
  const location: Location = useLocation();
  return useMemo((): RecoveryPorts => {
    const go = (to: Destination): void => {
      if (to === 'apps-browse') openAppsModal({ kind: 'browse' });
      else void navigate(PATH[to]);
    };
    return {
      reload,
      applyUpdate: reload,
      openSettings: requestSettings,
      navigate: go,
      signIn: (account: string): void => signInNeededFor.set(account),
      installAgent: (): void => go('agent'),
      requestPermission: (permission: BrowserPermission): void => {
        import('@/lib/recovery-route/permission-how').then(({ PERMISSION_ASK }): void => {
          const how: PermissionAsk = PERMISSION_ASK[permission];
          if (how.kind === 'agent-setup') go('agent');
          else if (how.kind === 'explain') toast({ title: 'Your browser decides this one', description: how.how });
          else prompt(how.media).catch((): void => { toast({ title: 'The browser did not allow it', description: 'Allow it in the site settings (the icon left of the address bar), then try again.', variant: 'destructive' }); });
        }, (error: unknown): void => { toast({ title: 'That did not open', description: describeFailure(error, 'Reload the page and try again.'), variant: 'destructive' }); });
      },
      askAdmins: ask,
      openChat: (member: OtherMember, draft: string): void => {
        const key: string = member.cid.toString();
        // A draft the person already started is theirs; the suggested one does not overwrite it.
        if (loadDraft(key) === '') saveDraft(key, draft);
        void navigate(conversationHref(location.pathname, location.search, { cid: key, username: member.name ?? key }));
      },
      reportBug: requestBugReport,
    };
  }, [navigate, location.pathname, location.search]);
}
