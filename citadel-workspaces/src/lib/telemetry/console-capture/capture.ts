/**
 * Console capture for this tab's session, while and only while the server says its uploads are
 * allowed. Until a consent answer allows them the console is not touched and nothing is held;
 * when one withdraws them the console is restored and what was held is discarded.
 *
 * Lines go only to an agent whose greeting offers `browser_console`, so an older agent is never
 * sent a request it cannot parse. A failed send stops capture until the workspace is opened
 * again: a WASM client older than the request cannot send it, and retrying would only fail.
 *
 * The agent checks the session's consent itself and redacts every line (telemetry/browser.rs);
 * nothing here is relied on for that.
 */
import type { BrowserConsoleEntry, InternalServiceRequest, MyConsent } from 'citadel-workspace-client-ts';
import { CAPTURE_LIMITS, ConsoleCaptureBuffer, type CaptureClock } from './buffer';
import { lineFrom } from './format';
import { hookConsole, type ConsoleTarget } from './hook';

export interface CaptureDeps {
  readonly clock: CaptureClock;
  readonly console: ConsoleTarget;
  /** The server's consent answers for this tab's session; returns the unsubscribe. */
  readonly onConsent: (listener: (consent: MyConsent) => void) => () => void;
  readonly agentTakesConsole: () => Promise<boolean>;
  readonly ownCid: () => Promise<bigint | null>;
  readonly send: (request: InternalServiceRequest) => Promise<void>;
  readonly newRequestId: () => string;
}

/** Starts following consent; the returned function stops capture for good. */
export function startConsoleCapture(deps: CaptureDeps): () => void {
  let allowed: boolean = false;
  let stopped: boolean = false;
  let unhook: (() => void) | null = null;
  // Sends in flight. What the console says meanwhile is not captured: a send path that logs
  // would otherwise feed every send into the next one.
  let sending: number = 0;

  const forward = async (entries: BrowserConsoleEntry[]): Promise<void> => {
    const cid: bigint | null = await deps.ownCid();
    if (cid === null || !allowed || stopped) return;
    const request: InternalServiceRequest = { BrowserConsole: { request_id: deps.newRequestId(), cid, entries } };
    sending += 1;
    await deps.send(request).catch((): void => stop()).finally((): void => { sending -= 1; });
  };
  const buffer: ConsoleCaptureBuffer = new ConsoleCaptureBuffer(deps.clock, CAPTURE_LIMITS, (entries: BrowserConsoleEntry[]): void => { forward(entries).catch((): void => stop()); });

  const release = (): void => {
    unhook?.();
    unhook = null;
    buffer.clear();
  };
  const engage = async (): Promise<void> => {
    // An agent that cannot say is an agent that does not take console lines.
    const takes: boolean = await deps.agentTakesConsole().catch((): boolean => false);
    if (!takes || !allowed || stopped || unhook !== null) return;
    unhook = hookConsole(deps.console, (level, args): void => {
      if (sending === 0) buffer.record(lineFrom(level, args));
    }, (): void => stop());
  };
  const unfollow: () => void = deps.onConsent((consent: MyConsent): void => {
    allowed = consent.uploads_allowed;
    if (allowed) void engage();
    else release();
  });
  const stop = (): void => {
    stopped = true;
    allowed = false;
    release();
    unfollow();
  };
  return stop;
}
