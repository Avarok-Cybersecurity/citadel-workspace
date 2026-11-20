import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PHRASE_COPY, TASK_COPY } from '@/lib/recovery/copy';
import { RECOVERY_STEP_UP, regeneratePhrase } from '@/lib/recovery/console-ops';
import type { Send } from '@/lib/sign-in/key-answer';
import { keyFailureCopy } from '@/lib/sign-in/copy';
import type { AccountRef } from '@/lib/sign-in/types';
import { RecoveryPhrasePanel } from './RecoveryPhrasePanel';

/** The console's "Make a new recovery phrase": a warning, the server's new phrase, shown once and checked. */
export function ConsolePhrase({ send, account, serverAddress, onDone }: {
  send: Send;
  account: AccountRef;
  serverAddress: string;
  onDone: () => void;
}): JSX.Element {
  const [words, setWords] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (words !== null) return <RecoveryPhrasePanel words={words} account={account.username} server={serverAddress} onDone={onDone} />;

  const make = (): void => {
    setBusy(true);
    setError(null);
    regeneratePhrase(send, account.cid, RECOVERY_STEP_UP).then(setWords, (e: unknown): void => { setError(keyFailureCopy(e)); setBusy(false); });
  };
  return (
    <div className="space-y-4" data-testid="console-phrase">
      <h3 className="text-base font-semibold">{TASK_COPY.phrase.title}</h3>
      <p className="text-sm text-muted-foreground">{TASK_COPY.phrase.detail} {PHRASE_COPY.regenerateWarning}</p>
      {error !== null && <p role="alert" className="text-sm text-destructive-emphasis">{error}</p>}
      <Button type="button" className="w-full min-h-[44px] gap-2" disabled={busy} onClick={make} data-testid="console-phrase-make">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
        {PHRASE_COPY.regenerate}
      </Button>
    </div>
  );
}
