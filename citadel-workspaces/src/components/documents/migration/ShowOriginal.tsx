/**
 * "Show original": the document as it was before the move, read-only (OriginalDocumentView),
 * opened on request. A load answered after "Hide original" (or after a later load) is not
 * shown; one that fails says why, and one that finds nothing says the original is gone.
 */
import { useRef, useState, type MutableRefObject } from 'react';
import type { CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { DocumentFiles } from '@/lib/document-files';
import type { OriginalDocument } from '@/lib/live-doc-migration/migration-report';
import { HIDE_ORIGINAL, ORIGINAL_GONE, ORIGINAL_OPENING, ORIGINAL_UNOPENED, SHOW_ORIGINAL } from '@/lib/live-doc-migration/migration-copy';
import { OriginalDocumentView } from './OriginalDocumentView';

export interface ShowOriginalProps {
  readonly docId: string;
  readonly loadOriginal: () => Promise<OriginalDocument | null>;
  readonly files: DocumentFiles;
  readonly loadCdocRuntime: CdocRuntimeFactory;
}

type Original =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'shown'; readonly original: OriginalDocument }
  | { readonly kind: 'failed'; readonly message: string };

export function ShowOriginal({ docId, loadOriginal, files, loadCdocRuntime }: ShowOriginalProps): JSX.Element {
  const [original, setOriginal] = useState<Original>({ kind: 'hidden' });
  // Each load's number: a load answered after "Hide original" (or a later load) is not shown.
  const attempt: MutableRefObject<number> = useRef<number>(0);
  const open: boolean = original.kind !== 'hidden';
  const toggle = (): void => {
    const mine: number = (attempt.current += 1);
    if (open) return setOriginal({ kind: 'hidden' });
    const settle = (next: Original): void => {
      if (attempt.current === mine) setOriginal(next);
    };
    setOriginal({ kind: 'loading' });
    loadOriginal().then(
      (found: OriginalDocument | null): void => settle(found === null ? { kind: 'failed', message: ORIGINAL_GONE } : { kind: 'shown', original: found }),
      (error: unknown): void => settle({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <>
      <div className="flex min-h-[44px] items-center">
        <button
          type="button"
          aria-expanded={open}
          data-testid="migration-show-original"
          onClick={toggle}
          className="inline-flex min-h-[44px] min-w-[44px] items-center rounded px-[8px] text-primary-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? HIDE_ORIGINAL : SHOW_ORIGINAL}
        </button>
      </div>
      {original.kind === 'loading' && <p role="status" className="text-muted-foreground">{ORIGINAL_OPENING}</p>}
      {original.kind === 'failed' && <p role="alert" data-testid="migration-original-error" className="text-destructive-emphasis">{ORIGINAL_UNOPENED} {original.message}</p>}
      {original.kind === 'shown' && <OriginalDocumentView docId={docId} original={original.original} files={files} loadCdocRuntime={loadCdocRuntime} />}
    </>
  );
}
