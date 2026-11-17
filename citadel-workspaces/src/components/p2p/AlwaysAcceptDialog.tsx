/**
 * "Always accept files from {peer}?" -- asked once, on the first offer from a peer that the
 * person has to answer by hand, with directions to where the answer can be changed later.
 * The answer is the chat settings' own auto-accept switch (useAlwaysAcceptPrompt).
 */
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Settings } from 'lucide-react';
import type { AlwaysAcceptPrompt } from './hooks/useAlwaysAcceptPrompt';

// h-auto: the shared footer lets a long label wrap (ui/footer-layout.ts), and min-h-11, a 44px
// target, would otherwise hold a two-line label to one line's height.
const ANSWER: string = 'min-h-11 h-auto';

export function AlwaysAcceptDialog({ prompt, peerName }: { prompt: AlwaysAcceptPrompt; peerName: string }): JSX.Element {
  const { offer } = prompt;
  return (
    <Dialog open={offer !== null} onOpenChange={(open: boolean): void => { if (!open) prompt.dismiss(); }}>
      <DialogContent className="bg-card border-surface text-foreground max-w-md" data-testid="always-accept-dialog">
        <DialogHeader>
          <DialogTitle>Always accept files from {peerName}?</DialogTitle>
          <DialogDescription>
            {peerName} wants to send you {offer?.fileName ?? 'a file'}. Files from {peerName} can download
            without asking from now on, or you can keep choosing each time.
          </DialogDescription>
        </DialogHeader>
        <p className="flex gap-2 rounded-lg bg-surface/50 p-3 text-sm text-muted-foreground" data-testid="always-accept-directions">
          <Settings className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            To change this later, open <strong className="text-foreground">Chat settings</strong> (the gear at the top
            of this chat), choose the <strong className="text-foreground">File</strong> tab, and switch{' '}
            <strong className="text-foreground">Auto-accept files from {peerName}</strong>.
          </span>
        </p>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" className={ANSWER} onClick={(): void => { void prompt.answer(false); }} data-testid="always-accept-no">
            Ask me each time
          </Button>
          <Button className={ANSWER} onClick={(): void => { void prompt.answer(true); }} data-testid="always-accept-yes">
            Always accept from {peerName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
