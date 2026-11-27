/**
 * Pairing the server's answers with the requests that named an id.
 *
 * A kernel whose ServerCapabilities say `request_ids` answers a request named by `request_id` with
 * the answer frame exactly as before, then `Answered { request_id, digest }`: lowercase hex SHA-256
 * of that answer frame's bytes (citadel-workspace-types/src/request_frame.rs). The agent forwards
 * server frames byte-for-byte (c2s_reader.rs), so the digest is of the bytes this page receives.
 *
 * Every frame is held here for a short while; a pairing frame takes the held frame its digest
 * names. One that names no held frame -- the agent kept the answer, or it aged out -- ends its
 * request with no answer, never with another frame. Nothing is held unless the server pairs.
 */
import { isVariant, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

/** How many frames, and for how long, are held for a pairing frame to name. */
export const HELD_FRAMES: number = 8;
export const HELD_MS: number = 10_000;

interface Held { bytes: Uint8Array; response: WorkspaceProtocolResponse; at: number }
type Settle = (response: WorkspaceProtocolResponse | null) => void;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest: ArrayBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b: number): string => b.toString(16).padStart(2, '0')).join('');
}

export class AnswerPairing {
  private held: Held[] = [];
  private readonly waiting: Map<bigint, Settle> = new Map();
  private pairs: boolean = false;

  constructor(private readonly now: () => number) {}

  /** Whether the session's server pairs answers; unknown, so no, until it says. */
  serverPairs(): boolean { return this.pairs; }

  /** Set from ServerCapabilities; cleared whenever the session's connection is set again. */
  setServerPairs(pairs: boolean): void {
    this.pairs = pairs;
    if (!pairs) this.held = [];
  }

  /** The answer to `requestId`, once its pairing frame names it; null when it names none held. */
  expect(requestId: bigint): { answer: Promise<WorkspaceProtocolResponse | null>; standDown: () => void } {
    const answer: Promise<WorkspaceProtocolResponse | null> = new Promise((settle: Settle): void => { this.waiting.set(requestId, settle); });
    return { answer, standDown: (): void => { this.waiting.delete(requestId); } };
  }

  /** Every received frame; true when it was a pairing frame, which is nobody else's to read. */
  readFrame(bytes: Uint8Array, response: WorkspaceProtocolResponse): boolean {
    if (isVariant(response, 'Answered')) {
      const { request_id: requestId, digest } = response.Answered;
      void this.claim(digest).then((answer: WorkspaceProtocolResponse | null): void => {
        const settle: Settle | undefined = this.waiting.get(BigInt(requestId));
        this.waiting.delete(BigInt(requestId));
        settle?.(answer);
      });
      return true;
    }
    if (!this.pairs) return false;
    const at: number = this.now();
    this.held = [...this.fresh(at), { bytes, response, at }].slice(-HELD_FRAMES);
    return false;
  }

  private fresh(at: number): Held[] {
    return this.held.filter((h: Held): boolean => at - h.at <= HELD_MS);
  }

  private async claim(digest: string): Promise<WorkspaceProtocolResponse | null> {
    for (const candidate of this.fresh(this.now()).reverse()) {
      if (await sha256Hex(candidate.bytes) !== digest) continue;
      this.held = this.held.filter((h: Held): boolean => h !== candidate);
      return candidate.response;
    }
    return null;
  }
}

/** The tab's one pairing: frames arrive at one place (message-extraction.ts) and are read here. */
export const answerPairing: AnswerPairing = new AnswerPairing((): number => performance.now());

/** A fresh request id: 64 random bits, so two tabs on one session never name a request alike. */
export function newRequestId(): bigint {
  return crypto.getRandomValues(new BigUint64Array(1))[0];
}
