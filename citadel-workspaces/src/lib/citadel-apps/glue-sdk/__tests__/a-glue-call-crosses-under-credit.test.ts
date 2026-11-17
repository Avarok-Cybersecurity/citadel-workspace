/**
 * A glue app's internal-HTTP, client and server, between two instances over the real gate and
 * router and a fake relay: a body longer than the initial credit crosses in full, each chunk past
 * the credit sent only after the other side reports one read (the router refuses one sent early);
 * and the server hears who called from the session, not the body.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '../../host/capabilities';
import { glueInstance, type GlueInstance } from '../../host/glue-instance';
import { STANDARD_HOST_POLICY } from '../../host/limits';
import { ManualClock } from '../../host/__tests__/fakes';
import { IHTTP_INITIAL_CREDIT, IHTTP_MAX_CHUNK_BYTES } from '../../sdk/generated/AbiConstants';
import { calendarPorts, type CalendarPorts } from '@/lib/calendar/ports';
import { IhttpRelay } from '@/lib/calendar/__tests__/ihttp-relay';
import { ihttpEndpoint, type IhttpEndpoint } from '../ihttp-endpoint';
import type { IhttpRequest } from '../ihttp-server';
import type { IhttpResponse } from '@/lib/citadel-apps/glue-sdk/ihttp-client';

const HELD: Capability[] = ['ihttp.serve', 'ihttp.call'];

function instance(name: string, relay: IhttpRelay, heard: IhttpRequest[]): IhttpEndpoint {
  const glue: GlueInstance = glueInstance({
    appId: 'net.avarok.calendar', ports: { ihttp: relay.port(name) }, held: new Set<Capability>(HELD), policy: STANDARD_HOST_POLICY,
    limits: { topics: null, p2p: null }, clock: new ManualClock(), pageUrl: 'https://w.example/n1', storageChanges: () => (): void => {},
  });
  const ports: CalendarPorts = calendarPorts(glue);
  void ports.ihttp.serve([{ method: 'POST', path: '/echo' }], { relay: true, p2p: false });
  return ihttpEndpoint(ports.ihttp, async (request: IhttpRequest) => {
    heard.push(request);
    return { status: 200, body: request.body };
  });
}

describe("a glue app's internal HTTP", () => {
  it('sends a body longer than the initial credit in full, under credit, both ways', async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const heard: IhttpRequest[] = [];
    instance('ana', relay, heard);
    const bob: IhttpEndpoint = instance('bob', relay, []);
    const chunks: number = IHTTP_INITIAL_CREDIT + 2;
    const body: Uint8Array = new Uint8Array(chunks * IHTTP_MAX_CHUNK_BYTES - 7).map((_v, i) => i % 251);
    const answer: IhttpResponse = await bob.client.request({ user: { app_id: 'net.avarok.calendar', username: 'ana' } }, 'relay', 'POST', '/echo', '', body);
    expect([answer.status, answer.from.username, answer.body]).toEqual([200, 'ana', body]);
    expect(heard.map((r) => r.caller.username)).toEqual(['bob']);
    const sent = (from: string, kind: string): number => relay.carried.filter((c) => c.from === from && typeof c.frame.kind === 'object' && kind in c.frame.kind).length;
    expect([sent('bob', 'Body'), sent('ana', 'Body')]).toEqual([chunks, chunks]);
    expect(sent('ana', 'Credit')).toBeGreaterThanOrEqual(chunks - IHTTP_INITIAL_CREDIT);
  });
});
