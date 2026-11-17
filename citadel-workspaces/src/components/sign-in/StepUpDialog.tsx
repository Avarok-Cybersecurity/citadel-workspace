import { useRef } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SIGN_IN_COPY } from '@/lib/sign-in/copy';

/**
 * "Confirm it's you" before a change to how the account signs in.
 *
 * The password is read from the field once, on submit, and the field is
 * cleared: it never enters React state. Choosing the key sends no password and
 * the server asks for a touch instead, which the security-key prompt shows.
 */
export function StepUpDialog({ open, keyAvailable, onConfirm, onCancel }: {
  open: boolean;
  keyAvailable: boolean;
  /** The typed password, or null to prove it with a key. */
  onConfirm: (password: string | null) => void;
  onCancel: () => void;
}): JSX.Element {
  const field: React.RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  const takePassword = (): string => {
    const value: string = field.current?.value ?? '';
    if (field.current) field.current.value = '';
    return value;
  };
  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const password: string = takePassword();
    if (password) onConfirm(password);
    else field.current?.focus();
  };
  return (
    <AlertDialog open={open} onOpenChange={(next: boolean) => { if (!next) { takePassword(); onCancel(); } }}>
      <AlertDialogContent data-testid="step-up" onOpenAutoFocus={(e: Event) => { e.preventDefault(); field.current?.focus(); }}>
        <form onSubmit={submit} className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{SIGN_IN_COPY.stepUpTitle}</AlertDialogTitle>
            <AlertDialogDescription>{SIGN_IN_COPY.stepUpBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="step-up-password">Your password</Label>
            <Input id="step-up-password" type="password" autoComplete="current-password" ref={field} />
          </div>
          <AlertDialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => { takePassword(); onCancel(); }} data-testid="step-up-cancel">Cancel</Button>
            {keyAvailable && (
              <Button type="button" variant="outline" className="gap-2" onClick={() => { takePassword(); onConfirm(null); }} data-testid="step-up-key">
                <KeyRound className="h-4 w-4" aria-hidden="true" />Use a security key
              </Button>
            )}
            <Button type="submit" data-testid="step-up-submit">Confirm</Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
