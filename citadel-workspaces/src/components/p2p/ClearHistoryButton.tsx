/**
 * Clearing this conversation's stored history.
 *
 * Split out of `ChatSettingsPanel` at its length ceiling -- an exemption is a
 * ceiling, not a licence -- and it cuts cleanly: it is the one control there
 * that owns an irreversible action and its own confirmation.
 *
 * Its history: the button used to `localStorage.removeItem('chat-history:' +
 * peerCid)`, a key nothing in this app has ever written, so it removed nothing
 * while the dialog promised the messages were gone. History lives behind
 * `messagePaginationStore`; `clearConversationHistory` clears the stored pages
 * AND the in-memory copy the open chat is rendering.
 */
import { useConfirm } from '@/components/shared/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { toastSuccess, toastError } from '@/lib/toast-helpers';
import { p2pMessengerManager } from '@/lib/p2p/p2p-messenger-manager';

/**
 * `peerCid` is a bigint here even though the panel above holds a string: a CID
 * is a bigint in a declaration, and the conversion belongs at the boundary
 * rather than inside every consumer.
 */
export function ClearHistoryButton({ peerCid, peerName }: { peerCid: bigint; peerName: string }): JSX.Element {
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  const { toast }: ReturnType<typeof useToast> = useToast();

  return (
    <button
      data-testid="clear-chat-history"
      className="w-full p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive-emphasis text-sm hover:bg-destructive/20 transition-colors"
      onClick={() => {
        void (async (): Promise<void> => {
          const ok: boolean = await confirm({
            title: `Clear all chat history with ${peerName}?`,
            description: 'Messages stored on this device are removed. This cannot be undone.',
            confirmLabel: 'Clear history',
          });
          if (!ok) return;
          // Was `localStorage.removeItem('chat-history:' + peerCid)`
          // — a key nothing in this app has ever written, so the
          // button removed nothing while the dialog promised the
          // messages were gone. History lives behind
          // messagePaginationStore; this clears the stored pages AND
          // the in-memory copy the open chat is rendering.
          try {
            await p2pMessengerManager.clearConversationHistory(peerCid);
            toastSuccess(toast, 'Chat history cleared', `Messages with ${peerName} were removed from this device.`);
          } catch (error) {
            toastError(
              toast,
              'Could not clear chat history',
              error instanceof Error ? error.message : 'Unknown error',
            );
          }
        })();
      }}
    >
      Clear Chat History
    </button>
  );
}
