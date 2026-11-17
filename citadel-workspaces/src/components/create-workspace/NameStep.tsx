import type { FormEvent, JSX } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SLUG_MAX, TENANT_DOMAIN } from '@/lib/onboarding/slug';
import { canContinueWith, type Availability } from '@/lib/onboarding/slug-availability';
import { StepHeading } from './StepHeading';

export interface NameStepProps {
  readonly displayName: string;
  readonly slug: string;
  readonly availability: Availability;
  readonly onDisplayNameChange: (value: string) => void;
  readonly onSlugChange: (value: string) => void;
  readonly onContinue: () => void;
}

const DISPLAY_NAME_MAX: number = 64;

function AvailabilityLine({ availability }: { readonly availability: Availability }): JSX.Element {
  switch (availability.state) {
    case 'idle':
      return <span className="text-muted-foreground">Pick the address your team will use.</span>;
    case 'checking':
      return (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Checking availability…
        </span>
      );
    case 'available':
      return (
        <span className="inline-flex items-center gap-1.5 text-success-emphasis">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Available
        </span>
      );
    case 'invalid':
    case 'unavailable':
    case 'error':
      return (
        <span className="inline-flex items-center gap-1.5 text-destructive-emphasis">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {availability.message}
        </span>
      );
  }
}

/** Step 1: what the workspace is called, and where it will live. */
export function NameStep(props: NameStepProps): JSX.Element {
  const { displayName, slug, availability } = props;
  const ready: boolean = displayName.trim().length > 0 && canContinueWith(availability);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (ready) props.onContinue();
  };

  return (
    <form onSubmit={submit} noValidate>
      <StepHeading title="Name your workspace">
        This is how your team will know it. You can change the name later; the address is permanent.
      </StepHeading>

      <div className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="workspace-name" className="text-sm font-medium text-foreground">
            Workspace name
          </label>
          <Input
            id="workspace-name"
            data-testid="create-display-name"
            value={displayName}
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="organization"
            placeholder="Acme Robotics"
            onChange={(e) => props.onDisplayNameChange(e.target.value)}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="workspace-slug" className="text-sm font-medium text-foreground">
            Workspace address
          </label>
          <div
            className={cn(
              'flex h-11 min-w-0 items-center overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring',
              availability.state === 'available' ? 'border-success' : 'border-input',
            )}
          >
            <input
              id="workspace-slug"
              data-testid="create-slug"
              value={slug}
              maxLength={SLUG_MAX}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-describedby="workspace-slug-status"
              aria-invalid={availability.state === 'invalid' || availability.state === 'unavailable'}
              onChange={(e) => props.onSlugChange(e.target.value)}
              placeholder="acme"
              className="h-full min-w-0 flex-1 bg-transparent px-3 text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
            />
            <span className="shrink-0 border-l border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              .{TENANT_DOMAIN}
            </span>
          </div>
          <p id="workspace-slug-status" data-testid="create-slug-status" aria-live="polite" className="min-h-6 text-sm">
            <AvailabilityLine availability={availability} />
          </p>
        </div>

        {slug.length > 0 && (
          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your workspace will live at</p>
            <p data-testid="create-host-preview" className="mt-1 break-all font-mono text-sm text-foreground">
              https://<span className="text-primary-accent">{slug}</span>.{TENANT_DOMAIN}
            </p>
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:items-center justify-between">
        <Link
          to="/?join=1"
          className="inline-flex min-h-[24px] items-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Running your own Citadel server? Use its address instead
        </Link>
        <Button type="submit" size="lg" disabled={!ready} data-testid="create-name-continue" className="h-11 gap-2">
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
