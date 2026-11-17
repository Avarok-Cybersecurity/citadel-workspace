/**
 * A link to read and copy: a read-only field that selects on focus, and Copy beside it, which
 * says Copied when the clipboard took it (use-copy-to-clipboard toasts a refusal).
 */
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard, type CopyToClipboard } from '@/hooks/use-copy-to-clipboard';

export function LinkField({ url, label, testId }: { url: string; label: string; testId: string }): JSX.Element {
  const { copied, copy }: CopyToClipboard = useCopyToClipboard();
  return (
    <div className="flex min-w-0 items-center gap-[8px]">
      <input readOnly value={url} aria-label={label} onFocus={(e) => e.target.select()} data-testid={`${testId}-field`}
        className="h-[36px] min-w-0 flex-1 rounded-[6px] border border-border bg-background px-[8px] font-mono text-xs text-foreground" />
      <Button type="button" variant="outline" size="sm" className="h-[36px] shrink-0 gap-[6px]" onClick={() => void copy(url)}
        data-testid={`${testId}-copy`}>
        {copied ? <Check className="h-[14px] w-[14px]" aria-hidden="true" /> : <Copy className="h-[14px] w-[14px]" aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
