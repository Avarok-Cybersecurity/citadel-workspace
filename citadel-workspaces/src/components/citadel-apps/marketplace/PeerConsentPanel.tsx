/**
 * One member's own answer for one install (owner decision OD4): serving and calling over P2P and
 * joining the app's channels, each allowed or revoked on its own, with what the server sees of
 * P2P traffic said under it; and the people this member will not be reached by through this app.
 * The words and the rules are consent-model.ts; this only draws them and reports the choice.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { blockableUsername, type MemberAsk } from '@/lib/citadel-apps/consent-model';
import type { ConsentPlane } from '@/lib/citadel-apps/member-consent-types';

const PLANE_TITLE: Record<ConsentPlane, string> = {
  serve: 'Answer requests from other members’ copies',
  call: 'Send requests straight to other members',
  topics: 'Join this app’s channels',
};

interface PeerConsentPanelProps {
  appName: string;
  asks: readonly MemberAsk[];
  blocked: readonly string[];
  busy: boolean;
  onSet: (plane: ConsentPlane, allowed: boolean) => void;
  onBlock: (username: string, block: boolean) => void;
}

export function PeerConsentPanel({ appName, asks, blocked, busy, onSet, onBlock }: PeerConsentPanelProps): JSX.Element {
  const [draft, setDraft] = useState<string>('');
  const name: string | null = blockableUsername(draft);
  return (
    <section className="flex flex-col gap-[12px] rounded-md bg-muted/40 p-[12px]" data-testid="apps-peer-consent" aria-label={`Direct connections for ${appName}`}>
      <ul className="flex flex-col gap-[12px]">
        {asks.map((ask: MemberAsk) => (
          <li key={ask.plane} className="flex items-start gap-[12px]" data-testid="apps-peer-ask" data-plane={ask.plane} data-allowed={String(ask.allowed)}>
            <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
              <span className="break-words text-sm font-medium text-foreground">{PLANE_TITLE[ask.plane]}</span>
              <span className="break-words text-sm text-foreground/80">{ask.copy}</span>
              {ask.disclosure !== null && <span className="break-words text-xs text-muted-foreground" data-testid="apps-peer-disclosure">{ask.disclosure}</span>}
              {ask.allowed === null && <span className="text-xs text-warning-emphasis">Not answered yet: off until you allow it.</span>}
            </div>
            <label htmlFor={`apps-peer-${ask.plane}`} className="flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center">
              <Switch id={`apps-peer-${ask.plane}`} checked={ask.allowed === true} disabled={busy} data-testid={`apps-peer-allow-${ask.plane}`}
                aria-label={`${PLANE_TITLE[ask.plane]} (${appName})`} onCheckedChange={(on: boolean) => onSet(ask.plane, on)} />
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-[8px]">
        <span className="text-sm font-medium text-foreground">Blocked people</span>
        {blocked.length === 0
          ? <span className="text-sm text-muted-foreground" data-testid="apps-peer-blocked-empty">Nobody. Anyone who allowed this app can reach you through it.</span>
          : (
            <ul className="flex flex-col gap-[4px]">
              {blocked.map((u: string) => (
                <li key={u} className="flex min-w-0 items-center gap-[8px]" data-testid="apps-peer-blocked-row" data-username={u}>
                  <span className="min-w-0 flex-1 break-all text-sm text-foreground">{u}</span>
                  <Button variant="outline" className="min-h-[44px] shrink-0" disabled={busy} onClick={() => onBlock(u, false)} data-testid="apps-peer-unblock">Unblock</Button>
                </li>
              ))}
            </ul>
          )}
        <form className="flex min-w-0 flex-wrap gap-[8px]" onSubmit={(e) => { e.preventDefault(); if (name !== null) { onBlock(name, true); setDraft(''); } }}>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Username to block" aria-label={`Block someone from reaching you through ${appName}`}
            className="min-h-[44px] min-w-0 flex-1 basis-[160px]" data-testid="apps-peer-block-input" />
          <Button type="submit" variant="outline" className="min-h-[44px] shrink-0" disabled={busy || name === null} data-testid="apps-peer-block">Block</Button>
        </form>
      </div>
    </section>
  );
}
