/**
 * The one double in the app-page harness: the member's local agent, at its socket (AgentLink), as
 * a script that plays a `citadel.session` transcript recorded from the real synchronized.work node
 * (fixtures/joined.json). What the page sends is recorded by variant; an `AppSessionOpen` is
 * answered `connected` with the transcript's `server_cid`, each `AppSessionSend` must carry exactly
 * the next `expect` step's bytes, and after it the `deliver` steps up to the next `expect` arrive
 * as `AppSessionMessage`s, as the node's answers would. The first open plays the transcript from
 * its start; a later one (the page reloaded, the agent still holding the session) from just after
 * the link's receipt, as a linked app greets and subscribes again. `tail` is played on request.
 */
import type { AgentLink, Json } from '@/lib/citadel-apps/runtime/agent-link';

export interface TranscriptStep {
  readonly what: string;
  readonly expect?: string;
  readonly deliver?: string;
}

export interface Transcript {
  readonly context: { readonly acting_username: string; readonly install_id: string; readonly node_id: string; readonly app_id: string; readonly server: string };
  readonly link_code: string;
  readonly session: { readonly cid: string };
  readonly steps: readonly TranscriptStep[];
  readonly tail: readonly TranscriptStep[];
  readonly expected: {
    readonly labels_after_catch_up: readonly string[];
    readonly labels_after_join: readonly string[];
    readonly notification: { readonly title: string; readonly body: string };
  };
}

/** One `AppSessionOpen` as the agent received it, and what it answered. */
export interface OpenSeen {
  readonly cid: string;
  readonly installId: string;
  readonly actingUsername: string;
  readonly server: string;
  readonly answeredServerCid: string;
  readonly answeredState: string;
}

/** What check-app-page.mjs reads: every request by variant, the opens, the sends matched, and the first mismatch. */
export interface AgentRecord {
  readonly requests: string[];
  readonly opens: OpenSeen[];
  /** Each matched send by its step's `what`, and the open (1-based) it was sent under. */
  readonly matched: { readonly what: string; readonly open: number }[];
  readonly delivered: string[];
  closes: number;
  /** Messages handed to the socket and not yet read by the page's listeners. */
  inFlight: number;
  mismatch: { readonly at: string; readonly want: string; readonly got: string } | null;
}

export interface ScriptedAgent {
  readonly link: AgentLink;
  readonly record: AgentRecord;
  /** Plays `tail`, with its `notify` step delivered `notifyTimes` times. */
  readonly playTail: (notifyTimes: number) => void;
}

const hex = (bytes: readonly number[]): string => bytes.map((b: number) => b.toString(16).padStart(2, '0')).join('');
const bytesOf = (h: string): Uint8Array => Uint8Array.from({ length: h.length / 2 }, (_: unknown, i: number) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
const variant = (request: Json): string => Object.keys(request)[0] ?? '(empty)';

export function scriptedAgent(t: Transcript): ScriptedAgent {
  const listeners: Set<(message: unknown) => void> = new Set<(message: unknown) => void>();
  const record: AgentRecord = { requests: [], opens: [], matched: [], delivered: [], closes: 0, inFlight: 0, mismatch: null };
  const serverCid: bigint = BigInt(t.session.cid);
  /** Where a reopened, already linked session resumes: just after the link's receipt. */
  const resumeAt: number = t.steps.findIndex((s: TranscriptStep) => s.what === 'receipt') + 1;
  let cursor: number = 0;
  let open: { cid: bigint; installId: string; session: number } | null = null;
  const emit = (message: Json): void => {
    // As a socket does: after the sender's own turn, never inside it.
    record.inFlight++;
    setTimeout((): void => {
      for (const l of [...listeners]) l(message);
      record.inFlight--;
    }, 0);
  };
  const deliver = (step: TranscriptStep): void => {
    if (open === null || step.deliver === undefined) return;
    record.delivered.push(step.what);
    emit({ AppSessionMessage: { cid: open.cid, request_id: undefined, install_id: open.installId, session: open.session, body: bytesOf(step.deliver) } });
  };
  const deliverUntilExpect = (): void => {
    while (cursor < t.steps.length && t.steps[cursor].expect === undefined) deliver(t.steps[cursor++]);
  };

  const onOpen = (body: Json): void => {
    const state: string = 'connected';
    const cid: bigint = body.cid as bigint;
    const installId: string = String(body.install_id);
    open = { cid, installId, session: record.opens.length + 1 };
    record.opens.push({ cid: String(cid), installId, actingUsername: String(body.acting_username), server: String(body.server), answeredServerCid: serverCid.toString(), answeredState: state });
    cursor = record.opens.length === 1 ? 0 : resumeAt;
    emit({ AppSessionState: { cid, request_id: body.request_id, install_id: installId, session: open.session, server_cid: serverCid, state } });
    deliverUntilExpect();
  };
  const onSend = (body: Json): void => {
    const got: string = hex(Array.isArray(body.body) ? (body.body as number[]) : []);
    if (record.mismatch !== null) return;
    const step: TranscriptStep | undefined = t.steps[cursor];
    if (step?.expect === undefined) {
      record.mismatch = { at: `after ${t.steps[cursor - 1]?.what ?? 'the start'} (the transcript expects nothing here)`, want: '', got };
      return;
    }
    if (got !== step.expect) {
      record.mismatch = { at: `${step.what} (step ${cursor})`, want: step.expect, got };
      return;
    }
    record.matched.push({ what: step.what, open: record.opens.length });
    cursor++;
    deliverUntilExpect();
  };

  const link: AgentLink = {
    send: async (request: Record<string, unknown>): Promise<void> => {
      const name: string = variant(request);
      record.requests.push(name);
      const body: Json = request[name] as Json;
      if (name === 'AppSessionOpen') onOpen(body);
      else if (name === 'AppSessionSend') onSend(body);
      else if (name === 'AppSessionClose') record.closes++;
    },
    listen: (handler: (message: unknown) => void): (() => void) => {
      listeners.add(handler);
      return (): void => { listeners.delete(handler); };
    },
    newRequestId: (): string => crypto.randomUUID(),
  };

  const playTail = (notifyTimes: number): void => {
    for (const step of t.tail) {
      const times: number = step.what === 'notify' ? notifyTimes : 1;
      for (let i: number = 0; i < times; i++) deliver(step);
    }
  };
  return { link, record, playTail };
}
