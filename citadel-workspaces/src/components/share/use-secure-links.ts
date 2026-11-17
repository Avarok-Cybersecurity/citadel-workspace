/**
 * Settings -> Security -> Secure links: the member's own live links, as the server lists them,
 * and the three things they can do to one. Every action re-reads the list afterwards, so the
 * meter and the rows are the server's word, not a local guess. A regenerated link's new token is
 * held here only until it is dismissed.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SecureLinkInfo, SecureLinksResponse } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import type { SecureLinksApi } from '@/lib/share/secure-links-api';
import { ttlOf, type LifetimePreset, type LinkQuota } from '@/lib/share/link-lifetime';
import { secureLinkUrl } from '@/lib/share/pending-redirect';
import type { DeleteOutcome, ExtendOutcome, RegenerateOutcome, SecureLinksListing } from '@/lib/workspace-service/secure-links-operations';

export type LinksState =
  | { kind: 'loading' }
  | { kind: 'loaded'; links: SecureLinkInfo[]; quota: LinkQuota }
  | { kind: 'failed'; message: string };

export interface SecureLinks {
  state: LinksState;
  busy: boolean;
  message: string | null;
  /** A regenerated link, shown once. */
  fresh: { id: string; url: string } | null;
  dismissFresh: () => void;
  reload: () => Promise<void>;
  extend: (id: string, preset: LifetimePreset) => Promise<void>;
  regenerate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const GONE_COPY: string = 'That link is no longer available. It may have expired or been used.';

const failureOf = (error: unknown): string => (error instanceof Error ? error.message : 'The server did not answer.');

export function useSecureLinks(api: Pick<SecureLinksApi, 'list' | 'extend' | 'regenerate' | 'remove'>, origin: string, server: string): SecureLinks {
  const [state, setState] = useState<LinksState>({ kind: 'loading' });
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);

  const reload: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const listing: SecureLinksListing = await api.list();
      setState({ kind: 'loaded', links: listing.links, quota: listing.quota });
    } catch (error: unknown) {
      setState({ kind: 'failed', message: failureOf(error) });
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);
  // A link made elsewhere in this session (a Share dialog) is in the list without a reopen.
  useEffect(() => eventEmitter.on('workspace:secure-links', (event: { answer: SecureLinksResponse } | undefined): void => {
    if (event !== undefined && typeof event.answer === 'object' && 'Created' in event.answer) void reload();
  }), [reload]);

  /** One action: busy while it runs, its outcome in words, then the list again. */
  const act = async (run: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await run());
    } catch (error: unknown) {
      setMessage(failureOf(error));
    } finally {
      await reload();
      setBusy(false);
    }
  };

  return {
    state, busy, message, fresh,
    dismissFresh: (): void => setFresh(null),
    reload,
    extend: (id: string, preset: LifetimePreset) => act(async (): Promise<string> => {
      const outcome: ExtendOutcome = await api.extend(id, ttlOf(preset));
      return outcome.kind === 'extended' ? 'Link extended.' : GONE_COPY;
    }),
    regenerate: (id: string) => act(async (): Promise<string> => {
      const outcome: RegenerateOutcome = await api.regenerate(id);
      if (outcome.kind !== 'regenerated') return GONE_COPY;
      setFresh({ id, url: secureLinkUrl(origin, outcome.token, server) });
      return 'New link made. The old one no longer works. It is shown once; copy it now.';
    }),
    remove: (id: string) => act(async (): Promise<string> => {
      const outcome: DeleteOutcome = await api.remove(id);
      return outcome.kind === 'deleted' ? 'Link deleted.' : GONE_COPY;
    }),
  };
}
