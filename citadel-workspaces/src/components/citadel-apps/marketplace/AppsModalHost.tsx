/**
 * The marketplace on every signed-in route: opened by the account menu, by an app zone, by a node's
 * "+" (the apps that can be a tab there), or by an app link --
 * the one captured at boot before sign-in (taken once, now that a session is up) and one followed
 * inside the app from chat or a document. A link for another workspace server is not opened here.
 * Lazy in App.tsx; the modal itself loads on its first open.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { browserSessionStorage } from '@/lib/chat/draft-handoff';
import { readAppLinkParams, takeAppLink, APP_LINK_PATH, APP_PARAM, type AppLink } from '@/lib/citadel-apps/app-link';
import { APP_LINK_KEYS } from '@/lib/citadel-apps/app-link-capture';
import type { Permission } from '@/lib/permissions-service/types';
import type { Authority, Tri } from '@/lib/citadel-apps/scope-options';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { closeAppsModal, openAppsModal, useAppsModalRequest, type AppsModalRequest } from '@/lib/citadel-apps/apps-modal-store';
import { sessionAppsTransport } from '@/lib/citadel-apps/apps-api';
import { thisTabsServer } from '@/lib/share/resolve-here';
import { sessionIsOnServer } from '@/lib/sessions/same-server';
import { browserClock } from '@/lib/browser-clock';
import { LazyAppsModal } from './LazyAppsModal';
import { useMarketplaceViewer } from './use-marketplace-viewer';
import { authorityFrom, PermissionProbes, probeKey, type OnProbeAnswer, type ProbeAnswers } from './PermissionProbes';
import type { MarketplaceDeps, MarketplaceViewer } from './marketplace-types';

async function fetchSameOrigin(url: string): Promise<string> {
  const response: Response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

const DEPS: MarketplaceDeps = {
  transport: sessionAppsTransport,
  fetchText: fetchSameOrigin,
  copyText: (text: string): Promise<void> => navigator.clipboard.writeText(text),
  clock: browserClock,
};

/** Open the marketplace on `link`, unless it names another workspace server. */
export async function openLinkHere(link: AppLink, server: () => Promise<string | null>, refuse: (other: string) => void): Promise<void> {
  if (link.server !== null) {
    const here: string | null = await server();
    if (here === null || !sessionIsOnServer({ server_address: here }, link.server)) { refuse(link.server); return; }
  }
  openAppsModal({ kind: 'link', link });
}

const refuseOtherServer = (other: string): void => {
  toast.error('This app link is for another workspace', { description: `It belongs to the workspace at ${other}. Sign in to an account there to open it.` });
};

export function AppsModalHost(): JSX.Element | null {
  const request: AppsModalRequest | null = useAppsModalRequest();
  const [shown, setShown] = useState<AppsModalRequest | null>(request);
  // Each request opens a fresh marketplace: the dialog stays mounted between openings.
  const [opening, setOpening] = useState<number>(0);
  const [server, setServer] = useState<string | null>(null);
  const location: ReturnType<typeof useLocation> = useLocation();
  const navigate: ReturnType<typeof useNavigate> = useNavigate();

  useEffect(() => { void thisTabsServer().then(setServer); }, []);

  // The link this tab arrived with, kept through sign-in: taken once, here.
  useEffect(() => {
    const link: AppLink | null = takeAppLink(browserSessionStorage());
    if (link !== null) void openLinkHere(link, thisTabsServer, refuseOtherServer);
  }, []);

  // A link followed inside the app: its keys leave the address, and it opens the marketplace.
  useEffect(() => {
    const params: URLSearchParams = new URLSearchParams(location.search);
    if (location.pathname !== APP_LINK_PATH || !params.has(APP_PARAM)) return;
    const link: AppLink | null = readAppLinkParams(params);
    for (const key of APP_LINK_KEYS) params.delete(key);
    const rest: string = params.toString();
    navigate(`${location.pathname}${rest === '' ? '' : `?${rest}`}`, { replace: true });
    if (link !== null) void openLinkHere(link, thisTabsServer, refuseOtherServer);
  }, [location.search, location.pathname, navigate]);

  useEffect(() => {
    if (request === null) return;
    setShown(request);
    setOpening((n: number) => n + 1);
  }, [request]);

  const [answers, setAnswers] = useState<ProbeAnswers>(new Map());
  const onAnswer: OnProbeAnswer = useCallback((permission: Permission, domain: string, answer: Tri): void => {
    setAnswers((held: ProbeAnswers) => (held.get(probeKey(permission, domain)) === answer ? held : new Map(held).set(probeKey(permission, domain), answer)));
  }, []);
  const authority: Authority = useMemo((): Authority => authorityFrom(answers), [answers]);

  const pageNodeId: string | null = new URLSearchParams(location.search).get('nodeId');
  const viewer: MarketplaceViewer | null = useMarketplaceViewer(pageNodeId, server, authority);
  if (shown === null || viewer === null) return null;
  const requestNodeId: string | null = shown.kind === 'link' ? shown.link.nodeId : shown.kind === 'tab' ? shown.target.nodeId : null;
  const domains: string[] = [WORKSPACE_ROOT_ID, pageNodeId, requestNodeId].filter((d: string | null): d is string => d !== null);
  return (
    <>
      <PermissionProbes domains={domains} onAnswer={onAnswer} />
      <LazyAppsModal key={opening} open={request !== null} onOpenChange={(open: boolean) => { if (!open) closeAppsModal(); }} request={shown} deps={DEPS} viewer={viewer} />
    </>
  );
}
