import { useEffect, useRef, useState } from 'react';
import { Copy, Download, LifeBuoy, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PHRASE_COPY } from '@/lib/recovery/copy';
import { PHRASE_FILE_NAME, phraseText } from '@/lib/recovery/phrase-file';
import type { RecoverySecret } from '@/lib/recovery/secret';
import { PhraseConfirm } from './PhraseConfirm';

/**
 * The recovery phrase, shown once, then checked: three of its words typed back before the person
 * moves on, so a phrase that was never written down is caught while it can still be read.
 *
 * The words live in this component's props and nowhere else: not in storage, not in a log, not in
 * a toast. Copy and Download are the person's own act.
 */
export function RecoveryPhrasePanel({ secret, account, server, onDone }: {
  secret: RecoverySecret;
  /** Named in the copied and downloaded text. */
  account: string;
  server: string | null;
  onDone: () => void;
}): JSX.Element {
  const [checking, setChecking] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef: React.RefObject<HTMLHeadingElement> = useRef<HTMLHeadingElement>(null);
  useEffect((): void => { if (!checking) headingRef.current?.focus(); }, [checking]);

  const words: readonly string[] = secret.words;
  const phrase: boolean = secret.kind === 'phrase';
  if (checking) {
    return <PhraseConfirm words={words.map((w: string) => w.toLowerCase())} onConfirmed={onDone} onShowAgain={(): void => setChecking(false)} />;
  }

  const text: string = phraseText(secret, account, server);
  const copy = (): void => {
    navigator.clipboard.writeText(text)
      .then((): void => setNotice('Copied. Paste it somewhere private, then clear your clipboard.'))
      .catch((): void => setNotice("Couldn't copy here. Write the words down, or download them."));
  };
  const download = (): void => {
    const url: string = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link: HTMLAnchorElement = document.createElement('a');
    link.href = url;
    link.download = PHRASE_FILE_NAME;
    link.click();
    URL.revokeObjectURL(url);
    setNotice('Downloaded. Move the file somewhere private.');
  };

  return (
    <section className="space-y-4" data-testid="recovery-phrase" aria-labelledby="recovery-phrase-title">
      <div className="flex items-center gap-2">
        <LifeBuoy className="h-5 w-5 shrink-0 text-primary-accent" aria-hidden="true" />
        <h2 id="recovery-phrase-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-foreground outline-none">
          {phrase ? PHRASE_COPY.title : PHRASE_COPY.codesTitle}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">{phrase ? PHRASE_COPY.body : PHRASE_COPY.codesBody}</p>
      <ol className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5 p-3 rounded-lg bg-background/50 border border-border font-mono text-sm select-all"
        aria-label={phrase ? `Recovery phrase, ${words.length} words in order` : 'Recovery codes'} data-testid="recovery-phrase-words">
        {words.map((word: string, i: number) => (
          <li key={i} className="flex min-w-0 items-baseline gap-2" data-testid="recovery-phrase-word">
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground" aria-hidden="true">{i + 1}</span>
            <span className="min-w-0 break-all text-foreground">{word}</span>
          </li>
        ))}
      </ol>
      <p className="flex gap-2 text-xs text-muted-foreground">
        <TriangleAlert className="h-4 w-4 shrink-0 text-warning-emphasis" aria-hidden="true" />{PHRASE_COPY.warning}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={copy} data-testid="recovery-phrase-copy">
          <Copy className="h-4 w-4" aria-hidden="true" />Copy
        </Button>
        <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={download} data-testid="recovery-phrase-download">
          <Download className="h-4 w-4" aria-hidden="true" />Download as text
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground" data-testid="recovery-phrase-notice">{notice ?? ''}</p>
      <Button type="button" className="w-full min-h-[44px]" onClick={(): void => setChecking(true)} data-testid="recovery-phrase-written">
        {phrase ? PHRASE_COPY.written : PHRASE_COPY.codesWritten}
      </Button>
    </section>
  );
}
