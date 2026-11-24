/**
 * An installed app's open questions to this member, asked where the app would run: each question
 * in the words the Installed panel uses (consent-model.ts, capability-copy.ts), and one answer for
 * all of them, sent to the server as the panel sends it (`SetPeerConsentForMe`). Answered, the
 * app starts; the finer choices (one plane at a time, blocking people) stay in Apps -> Installed.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PLANE_TITLE, type MemberAsk } from '@/lib/citadel-apps/consent-model';

interface MemberAnswerPromptProps {
  name: string;
  asks: readonly MemberAsk[];
  onAnswer: (allowed: boolean) => Promise<void>;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : 'The answer could not be sent.');

export function MemberAnswerPrompt({ name, asks, onAnswer }: MemberAnswerPromptProps): JSX.Element {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'refused'; why: string }>({ kind: 'idle' });
  const open: readonly MemberAsk[] = asks.filter((a: MemberAsk) => a.allowed === null);
  const send = (allowed: boolean): void => {
    setState({ kind: 'sending' });
    onAnswer(allowed).then(() => setState({ kind: 'idle' }), (e: unknown) => setState({ kind: 'refused', why: errorText(e) }));
  };
  const busy: boolean = state.kind === 'sending';
  return (
    <div className="flex flex-col gap-[8px]" data-testid="app-zone-questions">
      <ul className="flex flex-col gap-[8px]">
        {open.map((a: MemberAsk) => (
          <li key={a.plane} className="flex flex-col gap-[2px]" data-testid="app-zone-question" data-plane={a.plane}>
            <span className="break-words text-sm font-medium text-foreground">{PLANE_TITLE[a.plane]}</span>
            <span className="break-words text-sm text-muted-foreground">{a.copy}</span>
            {a.disclosure !== null && <span className="break-words text-xs text-muted-foreground">{a.disclosure}</span>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-[8px]">
        <Button className="min-h-[44px]" disabled={busy} onClick={() => send(true)} data-testid="app-zone-allow">{`Allow and start ${name}`}</Button>
        <Button variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => send(false)} data-testid="app-zone-decline">Start without it</Button>
      </div>
      <p className="break-words text-xs text-muted-foreground" role={state.kind === 'refused' ? 'alert' : undefined}>
        {state.kind === 'refused' ? state.why : 'You can change this at any time in Apps → Installed.'}
      </p>
    </div>
  );
}
