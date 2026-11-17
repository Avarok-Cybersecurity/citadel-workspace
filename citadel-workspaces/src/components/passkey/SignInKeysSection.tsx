import { useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PASSKEY_COPY, removeCopy } from '@/lib/passkey/copy';
import { SIGN_IN_COPY } from '@/lib/sign-in/copy';
import type { SignInCredential, SignInPolicy } from '@/lib/sign-in/types';
import { defaultPasskeyLabel } from '@/components/sign-in/default-key-label';
import { PolicyChoice } from '@/components/sign-in/PolicyChoice';
import { RecoveryCodesPanel } from '@/components/sign-in/RecoveryCodesPanel';
import { StepUpDialog } from '@/components/sign-in/StepUpDialog';
import { useStepUpPrompt, type StepUpPrompt } from '@/components/sign-in/useStepUpPrompt';
import { CredentialRow } from './CredentialRow';
import { useSignInKeys, type SignInKeys } from './useSignInKeys';

const POLICIES: readonly SignInPolicy[] = ['Password', 'PasswordAndKey', 'KeyOnly'];

/** Settings -> Security -> Sign-in keys: the account's factors, as the server holds them. */
export function SignInKeysSection(): JSX.Element | null {
  const stepUp: StepUpPrompt = useStepUpPrompt();
  const k: SignInKeys = useSignInKeys(stepUp.request);
  const [label, setLabel] = useState<string>(() => defaultPasskeyLabel(navigator.userAgent));
  const [removing, setRemoving] = useState<SignInCredential | null>(null);

  if (!k.account) return null;
  if (k.freshCodes) {
    return (
      <div className="p-3 rounded-lg bg-background/50">
        <RecoveryCodesPanel codes={k.freshCodes} account={k.account.username} onDone={k.forgetCodes} />
      </div>
    );
  }

  const keys: SignInCredential[] = k.listing?.keys ?? [];
  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (await k.add(label.trim())) setLabel(defaultPasskeyLabel(navigator.userAgent));
  };

  return (
    <div className="space-y-3" data-testid="sign-in-keys">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <KeyRound className="h-4 w-4 text-primary-accent" aria-hidden="true" />
        {PASSKEY_COPY.sectionTitle}
      </div>
      <p className="text-xs text-muted-foreground">{SIGN_IN_COPY.addKeyBody}</p>

      {k.listing === null ? (
        <div className="space-y-2 p-3 rounded-lg bg-background/50">
          <p className="text-xs text-muted-foreground">{SIGN_IN_COPY.stepUpBody}</p>
          <Button type="button" size="sm" variant="outline" disabled={k.busy} onClick={() => { void k.show(); }} data-testid="show-sign-in-keys">
            {SIGN_IN_COPY.showKeys}
          </Button>
        </div>
      ) : (<>
        {keys.length > 0 && (
          <ul className="space-y-2" aria-label="Your security keys">
            {keys.map((key: SignInCredential) => (
              <CredentialRow key={key.id} credential={key} busy={k.busy}
                onRename={(next: string) => k.rename(key.id, next)} onRemove={() => setRemoving(key)} />
            ))}
          </ul>
        )}

        {!k.available ? (
          <p className="text-xs text-muted-foreground">{PASSKEY_COPY.unavailableHere}</p>
        ) : (
          <form onSubmit={(e) => { void add(e); }} className="space-y-2 p-3 rounded-lg bg-background/50">
            <Label htmlFor="new-passkey-label" className="text-sm font-medium">Name this key</Label>
            <Input id="new-passkey-label" value={label} maxLength={64} onChange={(e) => setLabel(e.target.value)} />
            <p className="text-xs text-muted-foreground">{PASSKEY_COPY.pinNote}</p>
            <Button type="submit" size="sm" disabled={k.busy || !label.trim()} data-testid="add-passkey">{PASSKEY_COPY.addButton}</Button>
          </form>
        )}

        <div className="space-y-2 p-3 rounded-lg bg-background/50">
          <p className="text-sm font-medium">{SIGN_IN_COPY.policyTitle}</p>
          <PolicyChoice id="settings" value={k.listing.policy} options={POLICIES} disabled={k.busy}
            onChange={(next: SignInPolicy) => { void k.setPolicy(next); }} />
        </div>

        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background/50">
          <div>
            <p className="text-sm font-medium">Recovery codes</p>
            <p className="text-xs text-muted-foreground" data-testid="recovery-codes-left">
              {`${k.listing.codesLeft} unused. ${SIGN_IN_COPY.regenerateWarning}`}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" className="gap-2 shrink-0" disabled={k.busy}
            onClick={() => { void k.regenerateCodes(); }} data-testid="regenerate-recovery-codes">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />{SIGN_IN_COPY.regenerate}
          </Button>
        </div>
      </>)}

      <p role="status" className="text-xs text-muted-foreground" data-testid="sign-in-keys-status">{k.message ?? ''}</p>

      <StepUpDialog open={stepUp.open} keyAvailable={k.available} onConfirm={stepUp.confirm} onCancel={stepUp.cancel} />
      <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this key?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing ? removeCopy(removing.label) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="confirm-remove-key" onClick={() => { if (removing) void k.remove(removing.id); setRemoving(null); }}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
