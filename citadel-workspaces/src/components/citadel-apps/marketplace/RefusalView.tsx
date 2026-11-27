/**
 * An apps request that did not do what was asked (an install the server refused, or the listing a
 * link named): what happened, and a button for each next step (refusal-next-step.ts), so the
 * person always has something to press. Copying goes through the
 * marketplace's clipboard; when the clipboard cannot be reached, the text is shown to copy by hand.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  adminRequestText, nextStepId, nextStepLabel, reportText,
  type RefusalGuidance, type RefusalNextStep, type RefusedInstall,
} from '@/lib/citadel-apps/refusal-next-step';

export interface RefusalActions {
  retry: () => void;
  changeChoice: () => void;
  showInstalled: (installId: string) => void;
  browse: () => void;
  copyText: (text: string) => Promise<void>;
}

interface RefusalViewProps {
  /** What happened, in words. */
  message: string;
  /** The steps (refusal-next-step.ts `refusalNextSteps`, `linkedAppNextSteps`). */
  guidance: RefusalGuidance;
  /** What an admin request and a report say. */
  refused: RefusedInstall;
  actions: RefusalActions;
  testId: string;
}

type Copied = { kind: 'copied'; to: string } | { kind: 'not-copied'; text: string } | null;

export function RefusalView({ message, guidance, refused, actions, testId }: RefusalViewProps): JSX.Element {
  const [copied, setCopied] = useState<Copied>(null);
  const copy = async (text: string, to: string): Promise<void> => {
    try {
      await actions.copyText(text);
      setCopied({ kind: 'copied', to });
    } catch {
      setCopied({ kind: 'not-copied', text });
    }
  };
  const press = (step: RefusalNextStep): void => {
    switch (step.kind) {
      case 'retry': actions.retry(); return;
      case 'fix-input': actions.changeChoice(); return;
      case 'navigate': if (step.to.kind === 'installed-app') actions.showInstalled(step.to.installId); else actions.browse(); return;
      case 'ask-admin': void copy(adminRequestText(refused), 'Copied. Send it to a workspace admin.'); return;
      case 'report-bug': void copy(reportText(refused), 'Copied. Paste it into a message to the app’s publisher or to Avarok.'); return;
    }
  };

  return (
    <div className="flex flex-col gap-[12px] py-[12px]" data-testid={testId}>
      <p role="alert" className="break-words text-foreground">{message}</p>
      {guidance.forManagers !== null && (
        <p className="break-words text-sm text-muted-foreground" data-testid="apps-install-failed-managers">{guidance.forManagers}</p>
      )}
      <div className="flex flex-wrap gap-[8px]">
        {guidance.steps.map((step: RefusalNextStep, i: number) => (
          <Button key={nextStepId(step)} variant={i === 0 ? 'default' : 'outline'} className="min-h-[44px]" onClick={() => press(step)} data-testid={`apps-next-${nextStepId(step)}`}>
            {nextStepLabel(step)}
          </Button>
        ))}
      </div>
      {copied?.kind === 'copied' && <p role="status" className="text-sm text-foreground" data-testid="apps-next-copied">{copied.to}</p>}
      {copied?.kind === 'not-copied' && (
        <div className="flex flex-col gap-[4px]" data-testid="apps-next-not-copied">
          <p role="status" className="text-sm text-foreground">The clipboard could not be reached. Copy this by hand:</p>
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-[8px] text-xs text-foreground">{copied.text}</pre>
        </div>
      )}
    </div>
  );
}
