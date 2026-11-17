import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router';

/**
 * A URL naming a node that is not there.
 *
 * Two ways to arrive: a stale bookmark or shared link to something since
 * deleted, and a node deleted by someone else while you were reading it — the
 * deleting client navigates away, every other viewer stays put.
 *
 * Both used to render the "MDX Editor Showcase" demo, titled "Welcome to Your
 * Workspace", as though it were the document. The fallback chain ended in
 * `getDefaultMDXShowcase()` with no not-found state before it, so a deleted
 * page silently became a tutorial about the editor — and if the reader had been
 * editing, Save then failed for ever against a node that no longer existed,
 * with retry advice for an unrecoverable state.
 */
export function NodeNotFound({ nodeId }: { nodeId: string }): JSX.Element {
  const navigate: NavigateFunction = useNavigate();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8 text-muted-foreground">
      <FileQuestion className="h-12 w-12" aria-hidden="true" />
      <h2 className="text-xl text-foreground">This page is no longer here</h2>
      <p className="max-w-md text-center text-sm">
        It may have been deleted, or you may not have access to it. Nothing you had
        open has been lost — anything you were editing is still in this tab until you
        navigate away.
      </p>
      <p className="font-mono text-xs opacity-60">{nodeId}</p>
      <Button variant="secondary" onClick={() => navigate('/workspace')}>
        Back to the workspace
      </Button>
    </div>
  );
}
