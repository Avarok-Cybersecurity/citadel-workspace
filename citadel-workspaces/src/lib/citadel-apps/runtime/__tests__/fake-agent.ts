/**
 * TEST FAKE of the local agent as an app's ports reach it (AgentLink): it records every request
 * and answers through `answer`, a function of the request the test writes in the agent's own wire
 * shape (citadel-internal-service-types apps_net.rs / apps_kv.rs), delivered asynchronously as a
 * socket would.
 */
import type { AgentLink, Json } from '../agent-link';

export class FakeAgent implements AgentLink {
  readonly sent: Json[] = [];
  private readonly handlers: Set<(message: unknown) => void> = new Set();
  private next: number = 0;

  constructor(private readonly answer: (request: Json, agent: FakeAgent) => unknown[]) {}

  readonly newRequestId = (): string => `req-${++this.next}`;

  readonly listen = (handler: (message: unknown) => void): (() => void) => {
    this.handlers.add(handler);
    return (): void => { this.handlers.delete(handler); };
  };

  readonly send = async (request: Record<string, unknown>): Promise<void> => {
    this.sent.push(request);
    for (const message of this.answer(request, this)) this.emitSoon(message);
  };

  emitSoon(message: unknown): void {
    setTimeout((): void => { for (const h of [...this.handlers]) h(message); }, 0);
  }

  get listeners(): number {
    return this.handlers.size;
  }
}

/** The request body of the one variant in `request`. */
export const bodyOf = (request: Json): Json => Object.values(request)[0] as Json;
export const variantName = (request: Json): string => Object.keys(request)[0];
