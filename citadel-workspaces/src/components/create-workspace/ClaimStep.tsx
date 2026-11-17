import { useState, type JSX } from 'react';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AgentSetup } from '@/components/agent-setup/AgentSetup';
import { AGENT_SETUP_COPY } from '@/lib/agent-setup-copy';
import { StepHeading } from './StepHeading';

export interface ClaimStepProps {
  readonly workspaceHost: string;
  /** The code, on the one occasion it may be shown; `undefined` once it has been. */
  readonly claimCode: string | undefined;
  readonly onOpenWorkspace: () => void;
}

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * The control plane issues a 64-hex-character code. Shown in groups of eight so it
 * can be read back and checked by eye; the Copy button always copies it raw.
 */
function groupClaimCode(code: string): string {
  return /^[0-9a-f]{64}$/.test(code) ? (code.match(/.{8}/g) ?? [code]).join(' ') : code;
}

function ClaimCodePanel({ claimCode, onStored }: { readonly claimCode: string; readonly onStored: () => void }): JSX.Element {
  const [copy, setCopy] = useState<CopyState>('idle');
  const [stored, setStored] = useState<boolean>(false);

  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(claimCode);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-warning-emphasis">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Your claim code — shown only once
        </p>
        <p className="mt-2 text-sm text-foreground">
          Whoever enters this code becomes the owner of the workspace. Store it in your password manager
          now: Citadel does not keep a copy you can view again, and this page will not show it twice.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <code
          data-testid="claim-code"
          aria-label="Claim code"
          className="min-w-0 flex-1 select-all break-all rounded-lg border border-border bg-background px-4 py-3 font-mono text-lg tracking-wider text-foreground"
        >
          {groupClaimCode(claimCode)}
        </code>
        <Button type="button" variant="outline" size="lg" onClick={() => { void copyCode(); }} className="h-11 gap-2" data-testid="claim-code-copy">
          {copy === 'copied' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copy === 'copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p role="status" className="min-h-6 text-sm text-muted-foreground">
        {copy === 'copied' && 'Copied to the clipboard.'}
        {copy === 'failed' && 'Could not copy automatically. Select the code and copy it by hand.'}
      </p>

      <div className="flex items-start gap-3">
        <Checkbox id="claim-stored" checked={stored} onCheckedChange={(v) => setStored(v === true)} data-testid="claim-stored" />
        <label htmlFor="claim-stored" className="text-sm leading-[24px] text-foreground">
          I have stored the claim code somewhere safe.
        </label>
      </div>

      <div className="flex justify-end">
        <Button type="button" size="lg" disabled={!stored} onClick={onStored} data-testid="claim-continue" className="h-11 gap-2">
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/**
 * The workspace exists. Hand over the claim code, once, then point the way in.
 *
 * Two phases. The code is on screen only until the visitor says they have
 * stored it; after that this component has no path back to it, and neither does
 * the page -- the code was taken from a one-shot source (claim-handoff.ts) and
 * the control plane returns it exactly once. What stays in memory is only what
 * the initialization step needs to pre-fill it for this workspace.
 */
export function ClaimStep({ workspaceHost, claimCode, onOpenWorkspace }: ClaimStepProps): JSX.Element {
  const [concealed, setConcealed] = useState<boolean>(claimCode === undefined);

  return (
    <div data-testid="claim-step">
      <StepHeading title="Your workspace is ready">
        <CheckCircle2 className="mr-1.5 inline h-4 w-4 align-middle text-primary-accent" aria-hidden="true" />
        <span className="break-all font-medium text-foreground" data-testid="claim-host">{workspaceHost}</span> has been created.
      </StepHeading>

      {!concealed && claimCode !== undefined ? (
        <ClaimCodePanel claimCode={claimCode} onStored={() => setConcealed(true)} />
      ) : (
        <div className="space-y-5" data-testid="claim-next">
          {claimCode === undefined && (
            <p className="text-sm text-muted-foreground" data-testid="claim-already-shown">
              The claim code for this workspace has already been shown. Use the copy you stored.
            </p>
          )}
          <div>
            <h2 className="mb-2 text-base font-semibold text-foreground">1. {AGENT_SETUP_COPY.downloadHeading}</h2>
            <AgentSetup layout="full" navigatorRef={navigator} />
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-foreground">2. Open your workspace</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Create your account on {workspaceHost}, then enter the claim code when asked to become its owner.
            </p>
            <Button type="button" size="lg" onClick={onOpenWorkspace} data-testid="claim-open-workspace" className="h-11 w-full gap-2 sm:w-auto">
              Open your workspace
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
