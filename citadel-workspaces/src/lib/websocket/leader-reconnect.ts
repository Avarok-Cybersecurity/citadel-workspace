/**
 * The leader re-opening its socket on its own after losing it.
 *
 * Something has to. Before, the client library's own reconnect did, on a timer
 * of its own, and it is off now (it was one half of the reconnect storm; see
 * initialization.ts). Without a replacement the only re-opens left were side
 * effects: a request's `init()`, or the retry dialog's countdown. An idle or
 * backgrounded leader, or one whose dialog had been dismissed, therefore never
 * reconnected after the agent restarted -- and its followers, which proxy
 * everything through it, sat on a dead connection looking healthy.
 *
 * One timer, due when the backoff's window closes. A refused or failed attempt
 * schedules the next; a connection, or losing leadership, cancels it.
 *
 * Each loss and each connection is also reported to every tab, because the
 * followers are the tabs this outage is invisible to (agent-socket-state.ts).
 */
import type { ReconnectBackoff } from './reconnect-backoff';
import { instanceChannel } from '../multi-instance';
import { applyAgentSocketState } from '../multi-instance/agent-socket-state';

/** Apply here and tell the followers. */
export function broadcastAgentSocketState(up: boolean): void {
  applyAgentSocketState({ up });
  instanceChannel.send({ type: 'agent-socket', targetInstanceId: '*', payload: { up } });
}

export interface LeaderReconnectDeps {
  backoff: ReconnectBackoff;
  /** Whether a re-open is still wanted: this tab leads and holds no client. */
  wanted: () => boolean;
  /** Open the socket the way any caller does, through the service's init. */
  reopen: () => Promise<unknown>;
  report: (up: boolean) => void;
}

export class LeaderReconnect {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: LeaderReconnectDeps) {}

  /** The socket is up: stop retrying, and say so. */
  connected(): void {
    this.cancel();
    this.deps.report(true);
  }

  /** The socket is gone, or an attempt at one failed: retry when the window closes. */
  lost(): void {
    this.deps.report(false);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.deps.wanted()) return;
      void this.deps.reopen().catch(() => { this.schedule(); });
    }, this.deps.backoff.delayBeforeNextAttempt());
  }

  cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
