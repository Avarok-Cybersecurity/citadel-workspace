/**
 * A glue app's internal-HTTP client takes an answer only from whom it called (ihttp-client.ts):
 * frames on the call's stream from any other member of the same app, which the session stamps
 * truthfully, are not the call's, so a member cannot answer a booking in the host's place. The
 * addressed member's answer still completes the call afterwards.
 *
 * The io is a recording fake: the client's own acceptance of inbound frames is under test, and the
 * relay that would carry them (ihttp-relay.ts) delivers only frames a gate let through.
 */
import { describe, expect, it } from 'vitest';
import type { Caller } from '../../sdk/generated/Caller';
import { IhttpClient, type IhttpResponse } from '../ihttp-client';
import type { IhttpIo } from '../ihttp-io';
import { frame } from '../ihttp-outbox';

const APP: string = 'net.avarok.calendar';
const caller = (username: string, app_id: string = APP): Caller => ({ username, cid: 7n, app_id, install_id: `i-${username}`, via: 'relay' });
const io: IhttpIo = { call: async () => {}, respond: async () => {}, consumed: async () => {}, onFrame: () => () => {} };

/** Delivers the frames of a whole answer as the endpoint would: only those the client owns. */
function answer(client: IhttpClient, from: Caller, stream: bigint, status: number, text: string): void {
  for (const f of [frame(stream, { ResponseHead: { status, headers: [], body_len: BigInt(text.length) } }), frame(stream, { Body: { bytes: new TextEncoder().encode(text) } }), frame(stream, 'End')]) {
    if (client.owns(from, f)) client.take(from, f);
  }
}

describe("an internal-HTTP client's answer", () => {
  it('is taken only from the member it called, and that member answering still completes the call', async () => {
    const client: IhttpClient = new IhttpClient(io);
    let settled: IhttpResponse | null = null;
    const call: Promise<IhttpResponse> = client.request({ user: { app_id: APP, username: 'ana' } }, 'relay', 'POST', '/book', '', new Uint8Array([1]));
    void call.then((r: IhttpResponse) => { settled = r; });
    answer(client, caller('mallory'), 1n, 201, 'forged');
    answer(client, caller('ana', 'com.acme.other'), 1n, 201, 'other app');
    await Promise.resolve();
    expect(settled).toBeNull();
    answer(client, caller('ana'), 1n, 409, 'taken');
    const r: IhttpResponse = await call;
    expect([r.from.username, r.status, new TextDecoder().decode(r.body)]).toEqual(['ana', 409, 'taken']);
  });
});
