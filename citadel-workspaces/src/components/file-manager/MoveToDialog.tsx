/**
 * "Move to…": choose a folder for the selection. Only folders it can go to are
 * listed (move-destinations.ts); each move reports when the peer confirms it.
 */
import { useState } from 'react';
import { Folder, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { RevfsNode } from '@/types/revfs-types';
import { cn } from '@/lib/utils';
import { baseName } from '@/lib/revfs/tree-queries';
import { moveDestinations, type MoveDestination } from './move-destinations';
import { ROOT_LABEL } from './address-bar-model';

interface MoveToDialogProps {
  tree: RevfsNode;
  /** What is being moved; null while closed. */
  nodes: RevfsNode[] | null;
  onMove: (nodes: RevfsNode[], destination: string) => void;
  onClose: () => void;
}

export function MoveToDialog({ tree, nodes, onMove, onClose }: MoveToDialogProps): JSX.Element {
  const [chosen, setChosen] = useState<string | null>(null);
  const destinations: MoveDestination[] = nodes ? moveDestinations(tree, nodes) : [];
  const what: string = nodes?.length === 1 ? `“${nodes[0].name}”` : `${nodes?.length ?? 0} items`;
  const close = (): void => { setChosen(null); onClose(); };
  return (
    <Dialog open={nodes !== null} onOpenChange={(open: boolean) => { if (!open) close(); }}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Move {what}</DialogTitle>
          <DialogDescription>Choose the folder to move {nodes?.length === 1 ? 'it' : 'them'} to.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50dvh] overflow-y-auto rounded-[6px] border border-border" role="listbox" aria-label="Folders">
          {destinations.length === 0 && <li className="px-[12px] py-[10px] text-sm text-muted-foreground">There is no other folder to move to.</li>}
          {destinations.map((d: MoveDestination) => (
            <li key={d.path} role="option" aria-selected={chosen === d.path}>
              <button
                type="button" onClick={() => setChosen(d.path)}
                className={cn('flex min-h-[32px] w-full items-center gap-[8px] px-[12px] text-left text-sm hover:bg-surface', chosen === d.path && 'bg-primary/15 text-foreground')}
                style={{ paddingLeft: `${12 + d.depth * 16}px` }}
              >
                {d.path === '/' ? <Home className="h-[14px] w-[14px] shrink-0" aria-hidden="true" /> : <Folder className="h-[14px] w-[14px] shrink-0 text-primary-accent" aria-hidden="true" />}
                <span className="truncate">{d.path === '/' ? ROOT_LABEL : baseName(d.path)}</span>
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button disabled={chosen === null || nodes === null} onClick={() => { if (nodes && chosen) { onMove(nodes, chosen); close(); } }} data-testid="vfs-move-confirm">
            Move here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
