/**
 * Ways out of session and connection failures (RECOVERY-DESIGN.md §2.6 c). A slow reconnect waits
 * for the reconnect instead of reloading over it; a server that is down is retried instead of
 * sending the person to a sign-in that cannot fix it; an agent that is not there is installed.
 */
import type { DeclaredPlan } from '../route';

export const SESSION_SURFACES = {
  'session.agent-unreachable': { cause: 'environment', presentation: 'page', primary: { kind: 'wait', until: 'agent-online', deadlineMs: 20_000, then: { kind: 'install-agent', reason: 'missing' } }, alternatives: [{ kind: 'navigate', to: 'connect' }] },
  'session.reconnect-slow': { cause: 'environment', presentation: 'page', primary: { kind: 'wait', until: 'agent-reconnect', deadlineMs: 60_000, then: { kind: 'reload' } }, alternatives: [] },
  // The session is gone and nothing on this device can probe the server (connect-src 'self'; the
  // agent has no reachability request), so the way back is a sign-in, which itself tries the server.
  'session.server-unreachable': { cause: 'environment', presentation: 'page', primary: { kind: 'retry' }, alternatives: [{ kind: 'navigate', to: 'connect' }] },
  /** The person's network is down: wait for it, act by itself when it is back, then offer Try again. */
  'session.offline': { cause: 'environment', presentation: 'page', primary: { kind: 'wait', until: 'network-online', deadlineMs: 120_000, then: { kind: 'retry' } }, alternatives: [] },
  'session.workspace-timeout': { cause: 'ours', presentation: 'page', primary: { kind: 'retry' }, alternatives: [] },
  'session.agent-outdated': { cause: 'environment', presentation: 'page', primary: { kind: 'install-agent', reason: 'outdated' }, alternatives: [{ kind: 'retry' }] },
  'session.ended': { cause: 'policy', presentation: 'toast', primary: { kind: 'sign-in-again' }, alternatives: [] },
  'session.restore-failed': { cause: 'ours', presentation: 'toast', primary: { kind: 'sign-in-again' }, alternatives: [] },
  'session.takeover-failed': { cause: 'ours', presentation: 'toast', primary: { kind: 'sign-in-again' }, alternatives: [] },
  'session.messaging-unavailable': { cause: 'ours', presentation: 'toast', primary: { kind: 'reload' }, alternatives: [] },
  'session.setup-failed': { cause: 'ours', presentation: 'toast', primary: { kind: 'retry' }, alternatives: [] },
} as const satisfies Record<string, DeclaredPlan>;
