/**
 * The share dialog's secure-link flow: the choices, the quota, and the one-time token.
 *
 * Takes the API as an argument (lib/share/secure-links-api.ts in the app), so its states are
 * driven in tests by the same code the dialog runs. The token lives only in `phase` and goes
 * with it: closing the dialog forgets it, as the server already has.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SecureLinksApi } from '@/lib/share/secure-links-api';
import type { ShareTarget } from '@/lib/share/share-target';
import { draftOf, grantsOf, type GrantDraft } from '@/lib/share/grant-draft';
import { atLimit, lifetimeOf, type LifetimePreset, type LinkQuota } from '@/lib/share/link-lifetime';
import { secureLinkUrl } from '@/lib/share/pending-redirect';
import type { CreateOutcome } from '@/lib/workspace-service/secure-links-operations';

export type SecurePhase =
  | { kind: 'editing' }
  | { kind: 'creating' }
  | { kind: 'created'; url: string }
  | { kind: 'limit-reached' }
  | { kind: 'failed'; message: string };

export type QuotaState = { kind: 'loading' } | { kind: 'known'; quota: LinkQuota } | { kind: 'unknown'; message: string };

/** The lifetime a new link starts with; the creator sees it selected and can change it. */
export const INITIAL_PRESET: LifetimePreset = '24h';

export interface ShareLinkFlow {
  draft: GrantDraft;
  setDraft: (draft: GrantDraft) => void;
  preset: LifetimePreset;
  setPreset: (preset: LifetimePreset) => void;
  oneTime: boolean;
  setOneTime: (oneTime: boolean) => void;
  /** False while booking guests are chosen: their access lasts as long as the link, so the server refuses one-time. */
  oneTimeAllowed: boolean;
  quota: QuotaState;
  phase: SecurePhase;
  create: () => Promise<void>;
}

export interface ShareLinkContext {
  api: Pick<SecureLinksApi, 'list' | 'create'>;
  origin: string;
  /** The server this session is on: the link names it so the visitor's agent asks the right one. */
  server: string;
}

const failureOf = (error: unknown): string => (error instanceof Error ? error.message : 'The server did not answer.');

/** Mounted when the creator picks Secure, so the quota is asked for then, and once. */
export function useShareLinkFlow(target: ShareTarget, ctx: ShareLinkContext): ShareLinkFlow {
  const [draft, setDraft] = useState<GrantDraft>(() => draftOf(target.defaultGrant));
  const [preset, setPreset] = useState<LifetimePreset>(INITIAL_PRESET);
  const [oneTime, setOneTime] = useState<boolean>(false);
  const [quota, setQuota] = useState<QuotaState>({ kind: 'loading' });
  const [phase, setPhase] = useState<SecurePhase>({ kind: 'editing' });
  const { api, origin, server } = ctx;
  const oneTimeAllowed: boolean = draft.booking === null;
  const sentOneTime: boolean = oneTime && oneTimeAllowed;

  useEffect(() => {
    let live: boolean = true;
    setQuota({ kind: 'loading' });
    api.list().then(
      (listing) => {
        if (!live) return;
        setQuota({ kind: 'known', quota: listing.quota });
        if (atLimit(listing.quota)) setPhase((p: SecurePhase) => (p.kind === 'editing' ? { kind: 'limit-reached' } : p));
      },
      (error: unknown) => { if (live) setQuota({ kind: 'unknown', message: failureOf(error) }); },
    );
    return (): void => { live = false; };
  }, [api]);

  const create: () => Promise<void> = useCallback(async (): Promise<void> => {
    setPhase({ kind: 'creating' });
    try {
      const outcome: CreateOutcome = await api.create({
        target: target.href, label: target.label, grants: grantsOf(draft), lifetime: lifetimeOf(preset, sentOneTime),
      });
      setPhase(outcome.kind === 'created'
        ? { kind: 'created', url: secureLinkUrl(origin, outcome.token, server) }
        : { kind: 'limit-reached' });
    } catch (error: unknown) {
      setPhase({ kind: 'failed', message: failureOf(error) });
    }
  }, [api, target, draft, preset, sentOneTime, origin, server]);

  return { draft, setDraft, preset, setPreset, oneTime: sentOneTime, setOneTime, oneTimeAllowed, quota, phase, create };
}
