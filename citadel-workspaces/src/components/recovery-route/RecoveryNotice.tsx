/**
 * The one renderer for a failure and its way out (RECOVERY-DESIGN.md §2.5). The surface supplies
 * the sentence; the plan its id names supplies the controls, their words and their order. A wait
 * shows what it waits for and a countdown, then its fallback; an automatic retry shows its
 * attempt, then its fallback. Nothing here can render a failure with nowhere to go.
 */
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { initialPhase, runAutoPhase, type AutoClock, type AutoPhase } from '@/lib/recovery-route/auto-phase';
import type { AnyBinding } from '@/lib/recovery-route/binding';
import { controlsFor, type Control } from '@/lib/recovery-route/controls';
import { alternativesOf } from '@/lib/recovery-route/derive';
import { WAIT_LABEL } from '@/lib/recovery-route/labels';
import { lateBoundPorts } from '@/lib/recovery-route/ports-store';
import { planOf, type Recovery } from '@/lib/recovery-route/recovery';
import type { Presentation, RecoveryPlan } from '@/lib/recovery-route/route';
import { recordTrail } from '@/lib/recovery-route/trail';
import { describeFailure } from '@/lib/failure-message';

const browserClock: AutoClock = {
  now: (): number => Date.now(),
  after: (ms: number, fn: () => void): (() => void) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(fn, ms);
    return (): void => clearTimeout(timer);
  },
};

const FRAME: { readonly [K in Presentation]: string } = {
  inline: 'flex flex-col gap-2 text-sm',
  toast: 'flex flex-col gap-2 text-sm',
  banner: 'flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm',
  modal: 'flex flex-col gap-3 text-sm',
  page: 'mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center',
};

export interface RecoveryNoticeProps {
  readonly recovery: Recovery;
  /** What happened, in a sentence. The controls' words are the routes', never the caller's. */
  readonly message: React.ReactNode;
  readonly title?: string;
  readonly className?: string;
}

function useSecondsLeft(until: number | null): number | null {
  const [now, setNow] = useState<number>((): number => Date.now());
  useEffect((): (() => void) | undefined => {
    if (until === null) return undefined;
    const timer: ReturnType<typeof setInterval> = setInterval((): void => setNow(Date.now()), 1_000);
    return (): void => clearInterval(timer);
  }, [until]);
  return until === null ? null : Math.max(0, Math.ceil((until - now) / 1_000));
}

function statusLine(phase: AutoPhase, seconds: number | null): string | null {
  if (phase.kind === 'waiting') return `${WAIT_LABEL[phase.until]}… ${seconds ?? 0} s`;
  if (phase.kind === 'retrying') return `Trying again (${phase.attempt} of ${phase.of})… ${seconds ?? 0} s`;
  return null;
}

export function RecoveryNotice({ recovery, message, title, className }: RecoveryNoticeProps): JSX.Element | null {
  const { surface } = recovery;
  const plan: RecoveryPlan = planOf(surface);
  // The binding is read when a control runs or a wait starts, so a new object each render does
  // not restart a wait; the latest one is always the one used.
  const binding: React.MutableRefObject<AnyBinding> = useRef<AnyBinding>(recovery.binding as AnyBinding);
  binding.current = recovery.binding as AnyBinding;
  const [phase, setPhase] = useState<AutoPhase>((): AutoPhase => initialPhase(plan.primary, browserClock));
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  useEffect((): void => recordTrail({ at: Date.now(), kind: 'shown', surface }), [surface]);
  useEffect((): (() => void) => {
    setPhase(initialPhase(plan.primary, browserClock));
    // A resolved notice draws nothing; the screen behind it shows what came back.
    return runAutoPhase(plan.primary, binding.current, browserClock, setPhase);
  }, [plan.primary, surface]);

  const all: readonly Control[] = controlsFor(plan, binding.current, lateBoundPorts, surface);
  const seconds: number | null = useSecondsLeft(phase.kind === 'waiting' ? phase.deadlineAt : phase.kind === 'retrying' ? phase.nextAt : null);
  if (phase.kind === 'resolved') return null;
  // While a wait or a retry runs by itself, its fallback is not offered yet; the alternatives are.
  const shown: readonly Control[] = phase.kind === 'manual' ? all : all.slice(all.length - alternativesOf(plan).length);
  const status: string | null = statusLine(phase, seconds);

  const press = (control: Control): void => {
    recordTrail({ at: Date.now(), kind: 'taken', surface, route: control.kind });
    setBusy(true);
    control.run().then(
      (sentence: string | null): void => setSaid(sentence),
      (error: unknown): void => setSaid(describeFailure(error, `${control.label} did not work.`)),
    ).finally((): void => setBusy(false));
  };

  return (
    <div role={phase.kind === 'manual' ? 'alert' : 'status'} className={cn(FRAME[plan.presentation], className)} data-testid={`recovery-${surface}`}>
      {title !== undefined && <p className="font-medium text-foreground">{title}</p>}
      <div className="text-foreground">{message}</div>
      {status !== null && <p className="text-muted-foreground" data-testid="recovery-status">{status}</p>}
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {shown.map((control: Control, index: number): JSX.Element => (
            <Button
              key={`${control.kind}-${index}`}
              variant={index === 0 && phase.kind === 'manual' ? 'default' : 'outline'}
              className="min-h-[44px] min-w-[44px]"
              disabled={busy}
              onClick={(): void => press(control)}
              data-testid={`recovery-control-${control.kind}`}
            >
              {control.label}
            </Button>
          ))}
        </div>
      )}
      {said !== null && <p className="text-muted-foreground" data-testid="recovery-said">{said}</p>}
    </div>
  );
}
