import { createContext, useCallback, useContext, useRef, useState, type ReactNode ,  type MutableRefObject , type Context } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PromptRequest {
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
}

/**
 * A styled replacement for `window.prompt`, awaitable from a hook.
 *
 * Companion to useConfirm, and there for the same reason: asking for a folder
 * name through the browser's own prompt drops an unstyled operating-system box
 * into an otherwise designed app, and blocks the event loop while it is up.
 *
 * Resolves to the trimmed string, or null if the user cancels — matching what
 * `prompt()` returned, so the `if (!name?.trim()) return;` at the call sites
 * keeps working unchanged.
 *
 * No autoFocus: jsx-a11y forbids it, and it is not needed. Radix moves focus
 * into the dialog on open and the input is the first focusable thing in it —
 * DialogContent renders its close button after the children.
 */
const PromptContext: Context<((request: PromptRequest) => Promise<string | null>) | null> = createContext<((request: PromptRequest) => Promise<string | null>) | null>(null);

export function PromptDialogProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<PromptRequest | null>(null);
  const [value, setValue] = useState('');
  const resolveRef: MutableRefObject<((result: string | null) => void) | null> = useRef<((result: string | null) => void) | null>(null);

  const settle: (result: string | null) => void = useCallback((result: string | null): void => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setRequest(null);
    setValue('');
  }, []);

  const prompt: (next: PromptRequest) => Promise<string | null> = useCallback((next: PromptRequest): Promise<string | null> => {
    // Never strand a previous caller's promise.
    resolveRef.current?.(null);
    setRequest(next);
    setValue(next.initialValue ?? '');
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const submit: () => void = useCallback((): void => {
    const trimmed: string = value.trim();
    // Empty is a cancel, not an empty name — same as the native dialog's OK on
    // a blank field, which callers already treated as "do nothing".
    settle(trimmed ? trimmed : null);
  }, [value, settle]);

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      <Dialog open={request !== null} onOpenChange={(open) => { if (!open) settle(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{request?.title ?? ''}</DialogTitle>
            {request?.description && <DialogDescription>{request.description}</DialogDescription>}
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            className="space-y-2"
          >
            <label htmlFor="prompt-dialog-input" className="text-sm text-muted-foreground">
              {request?.label ?? ''}
            </label>
            <Input
              id="prompt-dialog-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={request?.placeholder}
            />
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => settle(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                // Named, for the reason round 417 named the confirm dialog's
                // action beside it: the label is whatever the caller passed --
                // 'Create folder', 'Create', a future rewording -- so a spec
                // that presses it by copy breaks the day the copy improves.
                // The input above has carried `#prompt-dialog-input` all along;
                // the button it submits had nothing.
                data-testid="prompt-dialog-confirm"
                disabled={!value.trim()}
              >
                {request?.confirmLabel ?? 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PromptContext.Provider>
  );
}

export function usePrompt(): (request: PromptRequest) => Promise<string | null> {
  const prompt: ((request: PromptRequest) => Promise<string | null>) | null = useContext(PromptContext);
  if (!prompt) {
    throw new Error('usePrompt must be used within a PromptDialogProvider');
  }
  return prompt;
}
