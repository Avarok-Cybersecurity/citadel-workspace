import { useRef, type ChangeEvent } from 'react';
import { RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { fileTransferService } from '@/lib/file-transfer';
import { failureDescription } from '@/lib/p2p/peer-failure-detail';

/**
 * The sender's one click when a reload lost a send and nothing was kept to send
 * it again by itself (lib/file-transfer/reload-recovery.ts). The browser cannot
 * read a picked file back after a reload, so the click asks for it once more and
 * the file goes to the same person. Only ever on the sender's own bubble, which
 * is failed by then and drawn on the surface colour (bubbles/types.ts).
 */
export function ResendLostFile({ transferId }: { transferId: string }): JSX.Element {
  const input: React.RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);

  const onPicked = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file: File | undefined = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    try {
      await fileTransferService.resendLostTransfer(transferId, file);
    } catch (err) {
      toast.error('Could not send the file again', { description: failureDescription(err, 'Check your connection and try again.') });
    }
  };

  return (
    <div className="mt-2">
      <input
        ref={input}
        type="file"
        className="hidden"
        data-testid="file-transfer-resend-input"
        aria-label="Choose the file to send again"
        onChange={(e: ChangeEvent<HTMLInputElement>): void => { void onPicked(e); }}
      />
      <button
        type="button"
        data-testid="file-transfer-resend"
        onClick={(e: React.MouseEvent): void => { e.stopPropagation(); input.current?.click(); }}
        className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded text-sm transition-colors border border-border text-foreground hover:bg-foreground/5"
      >
        <RotateCw className="h-4 w-4" />
        Send again
      </button>
    </div>
  );
}
