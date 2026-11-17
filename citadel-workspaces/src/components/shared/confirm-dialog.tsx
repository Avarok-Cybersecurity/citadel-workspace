import { createContext, useCallback, useContext, useRef, useState, type ReactNode ,  type MutableRefObject , type Context } from 'react';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

interface ConfirmRequest {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
}

/**
 * A styled confirmation that can be awaited from a hook.
 *
 * The app already had ConfirmDeleteDialog, but it is driven by `open` state, so
 * only a component could use it. Logic living in hooks — the file manager's
 * delete handlers, for one — reached for `window.confirm` instead: an unstyled
 * OS dialog in the middle of an otherwise designed app, which also blocks the
 * event loop and, incidentally, hangs any browser automation that has not
 * registered a dialog handler.
 *
 * This keeps the shape of the call the hooks were already making —
 * `if (!(await confirm({ ... }))) return;` — so the branch that reads as
 * "ask, then act" stays legible.
 */
const ConfirmContext: Context<((request: ConfirmRequest) => Promise<boolean>) | null> = createContext<((request: ConfirmRequest) => Promise<boolean>) | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  // Separate from `request`: answering closes the dialog but keeps its words, so
  // the exit animation does not play out as two buttons in an empty box.
  const [open, setOpen] = useState(false);
  // The pending promise's resolve, so answering the dialog settles the caller.
  const resolveRef: MutableRefObject<((confirmed: boolean) => void) | null> = useRef<((confirmed: boolean) => void) | null>(null);

  const settle: (confirmed: boolean) => void = useCallback((confirmed: boolean): void => {
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
    setOpen(false);
  }, []);

  const confirm: (next: ConfirmRequest) => Promise<boolean> = useCallback((next: ConfirmRequest): Promise<boolean> => {
    // A second request while one is open would strand the first caller's
    // promise for ever; answer it as declined rather than leaking it.
    resolveRef.current?.(false);
    setRequest(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDeleteDialog
        open={open}
        // Covers Escape, the backdrop and Cancel — every dismissal is a "no".
        onOpenChange={(open) => { if (!open) settle(false); }}
        title={request?.title ?? ''}
        description={request?.description}
        confirmLabel={request?.confirmLabel}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (request: ConfirmRequest) => Promise<boolean> {
  const confirm: ((request: ConfirmRequest) => Promise<boolean>) | null = useContext(ConfirmContext);
  if (!confirm) {
    // Explicit rather than a silent fallback to window.confirm: a missing
    // provider is a wiring mistake, and falling back would hide it behind the
    // very dialog this exists to replace.
    throw new Error('useConfirm must be used within a ConfirmDialogProvider');
  }
  return confirm;
}
