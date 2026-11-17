/**
 * A ribbon button that opens a small form (Link, Comment). Submitting closes the dialog and
 * sends the command; closing it either way hands focus back to the document, not the button.
 * What the person typed is kept until it is submitted: a stray tap outside or Escape closes
 * the dialog with the draft intact, the next open shows it again, and only Discard drops it.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { RibbonButton, type Shortcut } from './RibbonButton';
import { useRibbon, type Ribbon } from './ribbon-context';

/** What a field in the form needs to say it is the invalid one. */
export interface FieldState {
  readonly invalid: boolean;
  /** The id of the message explaining why, while one is shown. */
  readonly describedBy: string | undefined;
}

export interface RibbonDialogProps {
  readonly testId: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** The words beside the button's icon. */
  readonly text: string;
  readonly shortcut?: Shortcut;
  readonly unavailable?: string | null;
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  /** Why the form cannot be submitted yet, shown under it; null when it can. */
  readonly invalid: string | null;
  /** The form holds something the person typed. */
  readonly dirty: boolean;
  readonly onSubmit: () => void;
  /** Cancel: the draft is discarded. */
  readonly onDiscard: () => void;
  readonly children: (field: FieldState) => ReactNode;
}

export function RibbonDialog({ testId, label, icon, text, shortcut, unavailable, title, description, submitLabel, invalid, dirty, onSubmit, onDiscard, children }: RibbonDialogProps): JSX.Element {
  const { returnFocus }: Ribbon = useRibbon();
  const [open, setOpen] = useState<boolean>(false);
  const [tried, setTried] = useState<boolean>(false);
  const errorId: string = `${testId}-invalid`;
  const showing: boolean = tried && invalid !== null;
  const submit: (e: FormEvent<HTMLFormElement>) => void = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setTried(true);
    if (invalid !== null) return;
    setOpen(false);
    onSubmit();
  };
  return (
    <Dialog open={open} onOpenChange={(next: boolean): void => { setOpen(next); if (next) setTried(false); }}>
      <DialogTrigger asChild>
        <RibbonButton testId={testId} label={label} icon={icon} text={text} shortcut={shortcut} unavailable={unavailable} />
      </DialogTrigger>
      <DialogContent className="max-w-md border-border bg-card" data-testid={`${testId}-dialog`}
        onCloseAutoFocus={(e: Event): void => { e.preventDefault(); returnFocus(); }}>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle className="text-foreground">{title}</DialogTitle>
            <DialogDescription className="text-foreground/80">{description}</DialogDescription>
          </DialogHeader>
          {children({ invalid: showing, describedBy: showing ? errorId : undefined })}
          {showing && <p id={errorId} role="alert" data-testid={errorId} className="text-[14px] text-destructive">{invalid}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-[44px]" data-testid={`${testId}-cancel`}
              onClick={(): void => { setOpen(false); onDiscard(); }}>{dirty ? 'Discard' : 'Cancel'}</Button>
            <Button type="submit" className="min-h-[44px]" data-testid={`${testId}-submit`}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
