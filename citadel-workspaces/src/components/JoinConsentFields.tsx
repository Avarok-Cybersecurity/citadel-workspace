import { Checkbox } from '@/components/ui/checkbox';
import type { OptionalFieldChange } from './join-registration-shape';
import type { SignupConsentFields } from '@/lib/signup-consent';

interface JoinConsentFieldsProps {
  values: SignupConsentFields;
  onChange: OptionalFieldChange;
  disabled: boolean;
  /** On an Avarok-hosted server the Terms of Use are put to the person when they press Join. */
  termsAtJoin: boolean;
}

/** What is sent when diagnostics are on, in one plain line. Also the Privacy tab's description. */
export const DIAGNOSTICS_SENT: string = "Warnings and errors from the agent and this app's browser console, plus how your direct connections to other members went, with names, files and addresses removed.";

/**
 * The Profile step's agreements. Diagnostics are a choice of their own and stay off unless
 * ticked; the Terms are not a checkbox here but a dialog at Join (use-hosted-terms.tsx), and only
 * on a server Avarok hosts. Workspace terms, if the admins wrote any, need a session to be read:
 * they are shown right after sign-in, before anything else in the workspace.
 */
export function JoinConsentFields({ values, onChange, disabled, termsAtJoin }: JoinConsentFieldsProps): JSX.Element {
  return (
    <section aria-label="Agreements" className="space-y-3 pt-4 mt-4 border-t border-border">
      {termsAtJoin && (
        <p data-testid="join-terms-note" className="text-xs text-muted-foreground">
          When you press Join you will be asked to read and accept the{' '}
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline text-primary-accent">Terms of Use</a>.
        </p>
      )}
      <div className="flex items-start gap-2">
        <Checkbox id="join-diagnostics" data-testid="join-diagnostics" checked={values.shareDiagnostics} disabled={disabled}
          onCheckedChange={(on: boolean | 'indeterminate'): void => onChange('shareDiagnostics', on === true)} />
        <label htmlFor="join-diagnostics" className="text-sm leading-[24px] text-foreground">
          Share diagnostic logs with this workspace&apos;s admins
          <span className="block text-xs leading-snug text-muted-foreground">{DIAGNOSTICS_SENT} Optional; change it any time in Settings &gt; Privacy.</span>
        </label>
      </div>
    </section>
  );
}
