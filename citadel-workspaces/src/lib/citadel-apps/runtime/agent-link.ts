/**
 * The local agent as an app's host ports reach it: send one `InternalServiceRequest` carrying a
 * fresh `request_id`, and read the agent's messages for the answer naming that id. The agent is
 * the loopback agent this tab already talks to; nothing here opens, publishes or proxies a port.
 * Injected (SBIO): the page passes its websocket service, tests pass a fake agent.
 */

export interface AgentLink {
  /** Sends one request (a follower tab's goes through the leader, which routes the answer back by id). */
  readonly send: (request: Record<string, unknown>) => Promise<void>;
  /** Every agent message this tab sees; returns the unsubscribe. */
  readonly listen: (handler: (message: unknown) => void) => () => void;
  readonly newRequestId: () => string;
}

export type Json = Record<string, unknown>;

/** The body of `name` in an agent message, whether it arrives wrapped (`{Response: {...}}`) or not. */
export function variantOf(message: unknown, name: string): Json | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const m: Json = message as Json;
  const wrapped: unknown = m.Response;
  const value: unknown = typeof wrapped === 'object' && wrapped !== null ? (wrapped as Json)[name] : m[name];
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

/** The body of `name` when it answers `requestId`. */
export function answering(message: unknown, name: string, requestId: string): Json | undefined {
  const body: Json | undefined = variantOf(message, name);
  return body !== undefined && body.request_id === requestId ? body : undefined;
}

/** Bytes as the agent sends them: a byte array, or a list of numbers 0..255. */
export function bytesOf(value: unknown): Uint8Array | null {
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (Array.isArray(value) && value.every((b: unknown) => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 255)) return Uint8Array.from(value as number[]);
  return null;
}

export type AgentOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: 'send_failed' | 'no_answer' };

/**
 * Sends `build(requestId)` and resolves with the first message `read` accepts for it, or why there
 * was none within `timeoutMs`. The listener is removed either way.
 */
export function agentAsk<T>(link: AgentLink, build: (requestId: string) => Json, read: (message: unknown, requestId: string) => T | undefined, timeoutMs: number): Promise<AgentOutcome<T>> {
  const requestId: string = link.newRequestId();
  return new Promise<AgentOutcome<T>>((resolve: (o: AgentOutcome<T>) => void): void => {
    let done: boolean = false;
    const finish = (o: AgentOutcome<T>): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      resolve(o);
    };
    const stop: () => void = link.listen((message: unknown): void => {
      const value: T | undefined = read(message, requestId);
      if (value !== undefined) finish({ ok: true, value });
    });
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => finish({ ok: false, why: 'no_answer' }), timeoutMs);
    link.send(build(requestId)).catch((): void => finish({ ok: false, why: 'send_failed' }));
  });
}
