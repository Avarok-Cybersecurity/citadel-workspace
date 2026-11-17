/**
 * The address field: clickable breadcrumbs, and click-to-type.
 *
 * The empty space after the crumbs (and the chevron in it) switches the field to
 * a monospace input holding the current path. Enter resolves what was typed,
 * ignoring case; a path that names no folder is flagged inline and the field
 * stays open to fix it. Escape or leaving the field cancels.
 *
 * On a phone the folders between the top level and the open one collapse to
 * "…", which opens the typed path where the whole of it fits.
 */
import { useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react';
import { ChevronDown, ChevronRight, Folder, Home } from 'lucide-react';
import type { RevfsNode } from '@/types/revfs-types';
import { cn } from '@/lib/utils';
import { isEnterCommit } from '@/lib/keyboard-commit';
import { crumbsOf, resolveTypedPath, type Crumb, type PathResolution } from './address-bar-model';

interface AddressFieldProps {
  tree: RevfsNode | null;
  path: string;
  onOpenFolder: (path: string) => void;
}

const FIELD: string = 'flex h-[34px] min-w-0 flex-1 items-center rounded-[6px] border bg-background';

export function AddressField({ tree, path, onOpenFolder }: AddressFieldProps): JSX.Element {
  const [typed, setTyped] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const input: RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);

  const startTyping = (): void => {
    if (tree === null) return;
    setTyped(path);
    setNotFound(false);
    setTimeout((): void => { input.current?.focus(); input.current?.select(); }, 0);
  };
  const cancel = (): void => { setTyped(null); setNotFound(false); };

  if (typed !== null) {
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      if (!isEnterCommit(e) || tree === null) return;
      e.preventDefault();
      const found: PathResolution = resolveTypedPath(tree, typed);
      if (!found.ok) { setNotFound(true); return; }
      cancel();
      onOpenFolder(found.path);
    };
    return (
      <div className={cn(FIELD, 'gap-[8px] px-[10px]', notFound ? 'border-destructive' : 'border-ring')}>
        <Folder className="h-[14px] w-[14px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={input} value={typed} spellCheck={false} autoComplete="off"
          aria-label="Folder path" aria-invalid={notFound} aria-describedby={notFound ? 'vfs-path-error' : undefined}
          data-testid="vfs-path-input"
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setTyped(e.target.value); setNotFound(false); }}
          onKeyDown={onKeyDown} onBlur={cancel}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground outline-none"
        />
        {notFound && <span id="vfs-path-error" role="alert" className="shrink-0 text-xs text-destructive-emphasis">Folder not found</span>}
      </div>
    );
  }

  const crumbs: Crumb[] = crumbsOf(path);
  const hasMiddle: boolean = crumbs.length > 2;
  const crumb = (c: Crumb, i: number): JSX.Element => {
    const last: boolean = i === crumbs.length - 1;
    return (
      <li key={c.path} className={cn('flex items-center gap-[4px]', last ? 'min-w-0' : 'shrink-0', i > 0 && !last && 'hidden md:flex')}>
        {i > 0 && <ChevronRight className="h-[13px] w-[13px] shrink-0 text-muted-foreground" aria-hidden="true" />}
        <button
          type="button"
          onClick={() => onOpenFolder(c.path)}
          aria-current={last ? 'page' : undefined}
          data-testid={`vfs-breadcrumb-${i === 0 ? 'root' : c.name}`}
          className={cn(
            'flex h-[26px] min-w-[24px] items-center gap-[6px] rounded-[4px] px-[6px] text-sm hover:bg-surface',
            last ? 'min-w-0 font-semibold text-foreground' : 'shrink-0 text-muted-foreground',
          )}
        >
          {i === 0 && <Home className="h-[14px] w-[14px] shrink-0" aria-hidden="true" />}
          <span className="truncate">{c.name}</span>
        </button>
      </li>
    );
  };
  return (
    <nav className={cn(FIELD, 'gap-[4px] border-border pl-[4px]')} aria-label="Folder path">
      <ol className="flex min-w-0 items-center gap-[4px]">
        {crumb(crumbs[0], 0)}
        {hasMiddle && (
          <li className="flex items-center gap-[4px] md:hidden">
            <ChevronRight className="h-[13px] w-[13px] shrink-0 text-muted-foreground" aria-hidden="true" />
            <button type="button" onClick={startTyping} aria-label="Show the whole path" className="h-[26px] min-w-[24px] rounded-[4px] px-[6px] text-sm text-muted-foreground hover:bg-surface">…</button>
          </li>
        )}
        {crumbs.slice(1).map((c: Crumb, i: number) => crumb(c, i + 1))}
      </ol>
      <button
        type="button" onClick={startTyping} disabled={tree === null}
        aria-label="Type a path" data-testid="vfs-path-edit"
        className="flex h-full min-w-[32px] flex-1 items-center justify-end pr-[8px] text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className="h-[14px] w-[14px]" aria-hidden="true" />
      </button>
    </nav>
  );
}
