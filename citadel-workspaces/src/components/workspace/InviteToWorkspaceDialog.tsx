/**
 * How you get a colleague into your workspace.
 *
 * There was no answer to that. No invite link, no share surface, no copy
 * button — the only true entry path is Landing → "Create Account" → typing a
 * server address, and the product shows an existing user that address exactly
 * once, as a grey subtitle in the workspace-switcher dropdown, never framed as
 * "give this to somebody".
 *
 * So the first person sets up a workspace, wants their teammate in, and finds
 * nothing. They have to work out on their own that the teammate needs the raw
 * address and must register themselves — which is the step the product exists
 * to make easy.
 *
 * This needs no backend: the address is already known, and joining already
 * works. What was missing was saying so.
 */

import { Copy, Link2, UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { toastError, toastSuccess } from '@/lib/toast-helpers';
import { inviteLink } from '@/lib/invite-link';
import { dialledHost } from '@/lib/sessions/same-server';
import { useWorkspaceAddress } from '@/hooks/use-workspace-address';

interface InviteToWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  /** The connection record's address, when it has one; the tab's selection is asked otherwise. */
  serverAddress: string | undefined;
}

export function InviteToWorkspaceDialog({
  open,
  onOpenChange,
  workspaceName,
  serverAddress: connectionAddress,
}: InviteToWorkspaceDialogProps): JSX.Element {
  const { toast } = useToast();
  // What a person types and reads: a hosted workspace's host, not the `wss://…/` URL the agent dialled.
  const found: string | undefined = useWorkspaceAddress(open, connectionAddress);
  const serverAddress: string | undefined = found === undefined ? undefined : dialledHost(found);

  const copy = (text: string, done: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => toastSuccess(toast, done),
      () => toastError(toast, 'Could not copy', 'Your browser refused clipboard access. Select the text and copy it instead.'),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" aria-hidden="true" />
            Invite someone to {workspaceName}
          </DialogTitle>
          <DialogDescription>
            Send them the invite link: it opens <strong>Create Account</strong> with this
            address filled in. Or send the address, for them to paste in themselves.
          </DialogDescription>
        </DialogHeader>

        {serverAddress ? (
          <div className="space-y-3">
            <code className="block break-all rounded bg-muted px-3 py-2 text-sm">{serverAddress}</code>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => copy(serverAddress, 'Address copied')}>
                <Copy className="mr-2 h-4 w-4" aria-hidden="true" />Copy address
              </Button>
              <Button variant="outline" size="sm" onClick={() => copy(inviteLink(window.location.origin, serverAddress), 'Invite link copied')}>
                <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />Copy invite link
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Anyone who can reach this address can create an account on it. If your
              workspace is protected by a password, they will need that too — it is not
              included here, so send it separately.
            </p>
          </div>
        ) : (
          // Reached before the connection reports its address. Saying so beats
          // an empty box the user reads as "there is nothing to share".
          <p className="text-sm text-muted-foreground">
            The workspace address is not available yet. Give it a moment and try again.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
