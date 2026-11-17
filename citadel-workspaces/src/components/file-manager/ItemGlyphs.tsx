/**
 * The small marks on an item: its type badge, its icon, the E2E lock, the
 * pending note. Boxes are sized in px (the root font is 14px, so rem boxes come
 * out smaller than they read in the design); text uses the app's scale, whose
 * floor is 12px and which grows with the reader's font-size setting.
 */
import { Folder, FolderLock, Lock } from 'lucide-react';
import { PROTECTED_DIRS, type RevfsNode } from '@/types/revfs-types';
import { cn } from '@/lib/utils';
import { fileBadge, type FileBadge } from './vfs-content-helpers';

export function FileBadgeChip({ name, className }: { name: string; className?: string }): JSX.Element {
  const badge: FileBadge = fileBadge(name);
  return (
    // The tones are fixed hues, the same in either theme, each chosen to carry
    // white at 4.5:1 or better (a-file-badge-is-readable computes it). A text
    // colour that inverted with the theme would break exactly that pairing.
    // eslint-disable-next-line no-restricted-syntax
    <span className={cn('inline-flex h-[20px] min-w-[40px] items-center justify-center rounded-[4px] px-[6px] text-xs font-bold leading-none text-white', badge.tone, className)}>
      {badge.label}
    </span>
  );
}

/** A folder, or a page with the file's badge across its foot. */
export function ItemIcon({ node, size }: { node: RevfsNode; size: 'tile' | 'preview' }): JSX.Element {
  const box: string = size === 'tile' ? 'h-[52px] w-[44px]' : 'h-[72px] w-[60px]';
  if (node.type === 'directory') {
    const Icon: typeof Folder = PROTECTED_DIRS.has(node.path) ? FolderLock : Folder;
    return <Icon className={cn(size === 'tile' ? 'h-[44px] w-[44px]' : 'h-[64px] w-[64px]', 'text-primary-accent')} strokeWidth={1.5} aria-hidden="true" />;
  }
  return (
    <span className={cn('relative inline-flex items-end justify-center rounded-[6px] border border-border bg-background pb-[8px]', box)} aria-hidden="true">
      <FileBadgeChip name={node.name} className="absolute bottom-[8px]" />
    </span>
  );
}

/** End-to-end encrypted: every item in peer storage carries it. */
export function E2ELock({ className }: { className?: string }): JSX.Element {
  return (
    <span className={cn('inline-flex text-muted-foreground', className)} role="img" aria-label="End-to-end encrypted" title="End-to-end encrypted">
      <Lock className="h-[13px] w-[13px]" aria-hidden="true" />
    </span>
  );
}

/** A change the peer has not confirmed yet; it is retried. */
export function PendingMark({ peer }: { peer: string }): JSX.Element {
  return (
    <span className="text-xs text-warning-emphasis" data-testid="vfs-pending" title={`${peer} has not confirmed this yet; it is retried automatically.`}>
      Pending confirmation
    </span>
  );
}
