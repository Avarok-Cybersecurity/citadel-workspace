/**
 * The two ways a write waits for the server's answer.
 *
 * PAIRED, when the session's server pairs answers with request ids (answer-pairing.ts): the answer
 * is the one frame named for this request. Another request's answer, a late one, a broadcast or
 * another caller's Error cannot settle it.
 *
 * NEXT OF A KIND, against a server built before ids: the first `accepted` answer `matches` lets
 * through, or the first Error of any request. A late answer can be taken for a later request's;
 * the apps path holds its line over that (apps-operations.ts serialAppsTransport).
 */
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { answerPairing } from './answer-pairing';

/** How long to wait before treating silence as a failure. */
export const WRITE_RESPONSE_TIMEOUT_MS: number = 15_000;

/**
 * A write the server did not answer in time. `paired`: the wait was for this request's own
 * answer, so a late one can no longer be taken for anything else's.
 */
export class WriteResponseTimeout extends Error {
  constructor(readonly paired: boolean) {
    super(`The server did not answer within ${WRITE_RESPONSE_TIMEOUT_MS / 1000}s. The change may not have been saved.`);
  }
}

/** The server's answer to this request, which was not one it can succeed with. */
export class WriteAnswerUnfit extends Error {}

/** The server refused this request: its answer was the protocol's plain `Error`, whose words this carries. */
export class WriteRefused extends Error {}

export interface AnswerWait { settled: Promise<void>; standDown: () => void }
type Matches = ((payload: unknown) => boolean) | undefined;

export function describeFailure(response: Record<string, unknown>): string {
  const detail: unknown = response.Error;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const [variant, value] = Object.entries(detail)[0] ?? [];
    return typeof value === 'string' ? `${variant}: ${value}` : String(variant);
  }
  return 'The server rejected the request.';
}

function timed(paired: boolean, settle: (resolve: () => void, reject: (e: Error) => void, clear: () => void) => () => void): AnswerWait {
  let standDown: () => void = (): void => {};
  const settled: Promise<void> = new Promise<void>((resolve: () => void, reject: (e: Error) => void): void => {
    let release: () => void = (): void => {};
    const timeoutId: ReturnType<typeof setTimeout> = setTimeout((): void => { release(); reject(new WriteResponseTimeout(paired)); }, WRITE_RESPONSE_TIMEOUT_MS);
    const clear = (): void => { clearTimeout(timeoutId); release(); };
    release = settle(resolve, reject, clear);
    standDown = clear;
  });
  return { settled, standDown };
}

/**
 * The answer named for `requestId`, judged: an Error rejects, an accepted one that matches resolves.
 * `accepted` null: any answer but an Error is fine.
 */
export function waitForPairedAnswer(requestId: bigint, accepted: readonly string[] | null, matches: Matches): AnswerWait {
  return timed(true, (resolve, reject, clear): (() => void) => {
    const expected: ReturnType<typeof answerPairing.expect> = answerPairing.expect(requestId);
    void expected.answer.then((response: WorkspaceProtocolResponse | null): void => {
      clear();
      if (response === null) { reject(new Error('The server answered, but its answer could not be read. The change may not have been saved.')); return; }
      const responseType: string = Object.keys(response)[0] ?? '';
      const payload: unknown = (response as Record<string, unknown>)[responseType];
      if (responseType === 'Error') reject(new WriteRefused(describeFailure(response as Record<string, unknown>)));
      else if ((accepted === null || accepted.includes(responseType)) && (!matches || matches(payload))) resolve();
      else reject(new WriteAnswerUnfit(`The server answered ${responseType}, which does not fit the request.`));
    });
    return expected.standDown;
  });
}

/** The next accepted answer `matches` lets through, or the next Error of any request. */
export function waitForNextAnswer(accepted: readonly string[], matches: Matches): AnswerWait {
  return timed(false, (resolve, reject, clear): (() => void) => {
    const handler = (response: unknown): void => {
      if (!response || typeof response !== 'object') return;
      const responseType: string | undefined = Object.keys(response)[0];
      if (responseType === undefined) return;
      if (responseType === 'Error') { clear(); reject(new WriteRefused(describeFailure(response as Record<string, unknown>))); return; }
      if (!accepted.includes(responseType)) return;
      // A broadcast of the same variant from another member is not our answer.
      if (matches && !matches((response as Record<string, unknown>)[responseType])) return;
      clear();
      resolve();
    };
    eventEmitter.on('workspace:raw-response', handler);
    return (): void => { eventEmitter.off('workspace:raw-response', handler); };
  });
}
