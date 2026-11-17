import { useEffect, useRef, useState } from 'react';
import { Copy, Download, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { SIGN_IN_COPY } from '@/lib/sign-in/copy';

/** The codes as one block of text: what Copy puts on the clipboard and Download saves. */
export const codesText = (codes: readonly string[], account: string): string =>
  `Recovery codes for ${account}\nEach code signs in once.\n\n${codes.join('\n')}\n`;

/**
 * The recovery codes, shown once.
 *
 * They live in this component's props and nowhere else: not in storage, not in
 * a log, not in a toast. Copy and Download are the user's own act, and
 * Continue stays disabled until they say the codes are saved, because closing
 * this is the last time anyone can see them.
 */
export function RecoveryCodesPanel({ codes, account, onDone }: {
  codes: readonly string[];
  /** Named in the downloaded file, so the codes are not a mystery in a year. */
  account: string;
  onDone: () => void;
}): JSX.Element {
  const [saved, setSaved] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef: React.RefObject<HTMLHeadingElement> = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const copy = (): void => {
    navigator.clipboard.writeText(codesText(codes, account))
      .then((): void => setNotice('Copied.'))
      .catch((): void => setNotice("Couldn't copy here. Select the codes and copy them, or download them."));
  };
  const download = (): void => {
    const url: string = URL.createObjectURL(new Blob([codesText(codes, account)], { type: 'text/plain' }));
    const link: HTMLAnchorElement = document.createElement('a');
    link.href = url;
    link.download = 'citadel-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
    setNotice('Downloaded.');
  };

  return (
    <section className="space-y-4" data-testid="recovery-codes" aria-labelledby="recovery-codes-title">
      <div className="flex items-center gap-2">
        <LifeBuoy className="h-5 w-5 text-primary-accent" aria-hidden="true" />
        <h2 id="recovery-codes-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-foreground outline-none">
          {SIGN_IN_COPY.codesTitle}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">{SIGN_IN_COPY.codesBody}</p>
      <ol className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-background/50 font-mono text-sm select-all" aria-label="Recovery codes">
        {codes.map((code: string) => <li key={code} data-testid="recovery-code">{code}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={copy} data-testid="recovery-codes-copy">
          <Copy className="h-4 w-4" aria-hidden="true" />Copy
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={download} data-testid="recovery-codes-download">
          <Download className="h-4 w-4" aria-hidden="true" />Download
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">{notice ?? ''}</p>
      <div className="flex items-center gap-2">
        <Checkbox id="recovery-codes-saved" checked={saved} onCheckedChange={(v) => setSaved(v === true)} data-testid="recovery-codes-saved" />
        <Label htmlFor="recovery-codes-saved" className="text-sm">{SIGN_IN_COPY.codesSaved}</Label>
      </div>
      <Button type="button" className="w-full" disabled={!saved} onClick={onDone} data-testid="recovery-codes-done">Continue</Button>
    </section>
  );
}
