/**
 * Console capture with its real I/O, run by the workspace's TermsGate while a workspace is open.
 * None of it is on the landing page's critical path (check-bundle-budget's DEFERRED_MODULES).
 * The returned function stops it: the console is restored and nothing held is kept.
 */
import { onServerConsent } from '../consent-feed';
import { agentCapabilities, type AgentCapabilities } from '@/lib/agent-conversations/capabilities';
import { sendToAgent } from '@/lib/agent-conversations/sender';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { startConsoleCapture } from './capture';

export function bootConsoleCapture(): () => void {
  return startConsoleCapture({
    clock: {
      now: (): number => Date.now(),
      after: (ms: number, fn: () => void): (() => void) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(fn, ms);
        return (): void => clearTimeout(timer);
      },
    },
    console: window.console,
    onConsent: onServerConsent,
    agentTakesConsole: (): Promise<boolean> => agentCapabilities().then((c: AgentCapabilities): boolean => c.takesConsole),
    ownCid: getCurrentCid,
    send: sendToAgent,
    newRequestId: (): string => crypto.randomUUID(),
  });
}
