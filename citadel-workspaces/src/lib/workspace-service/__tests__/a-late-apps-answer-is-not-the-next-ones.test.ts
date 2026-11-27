/**
 * An apps answer that comes after its request gave up is not taken as the next request's answer.
 *
 * The workspace protocol carries no request id, and the apps transport takes any refusal as the
 * answer to whatever is waiting. A request that times out (15s) still has its answer coming; the
 * kernel answers a connection's requests in order, so that late answer arrives before the next
 * request's own. Taken by the next request, a refusal of an install would be shown as the refusal
 * of whatever was asked next -- a listing, the installs, another app.
 *
 * Real: the production transport, the serial queue, the write gate and the event bus, under fake
 * timers. The sender is the injected I/O boundary: it records frames, and the test plays the
 * kernel's answers onto the bus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppsRequest, WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { viewOf } from '@/test-utils/request-view';
import { listCatalogue, listInstalls, protocolAppsTransport, serialAppsTransport, type AppsResult, type AppsTransport } from '../apps-operations';
import { WRITE_RESPONSE_TIMEOUT_MS } from '../await-write-response';
import type { ProtocolSender } from '../workspace-operations';

function wire(): { t: AppsTransport; sent: AppsRequest[] } {
  const sent: AppsRequest[] = [];
  const sender: ProtocolSender = {
    currentCid: 7n,
    sendProtocolRequest: async (request: WorkspaceProtocolRequest): Promise<void> => {
      const apps: AppsRequest | undefined = viewOf(request).Apps;
      if (apps !== undefined) sent.push(apps);
    },
  };
  return { sent, t: serialAppsTransport(protocolAppsTransport(sender)) };
}
const answer = (raw: unknown): void => { eventEmitter.emit('workspace:raw-response', { Apps: raw }); };
const ticks = async (): Promise<void> => { for (let i: number = 0; i < 20; i += 1) await Promise.resolve(); };

describe('a late apps answer', () => {
  beforeEach((): void => { vi.useFakeTimers(); });
  afterEach((): void => { vi.useRealTimers(); });

  it('is not taken by the request after the one that timed out', async () => {
    const { t, sent } = wire();
    const first: Promise<AppsResult<unknown>> = listInstalls(t);
    await ticks();
    await vi.advanceTimersByTimeAsync(WRITE_RESPONSE_TIMEOUT_MS);
    expect(await first).toEqual({ ok: false, refusal: 'NoAnswer' });

    const second: Promise<AppsResult<unknown>> = listCatalogue(t);
    await ticks();
    // The first request's answer, late: a refusal.
    answer({ Refused: 'Unavailable' });
    await ticks();
    // The second's own answer, which the kernel sends after it.
    answer({ Catalogue: { listings: [] } });
    expect(await second).toEqual({ ok: true, value: [] });
    expect(sent).toEqual(['ListInstalls', 'ListCatalogue']);
  });

  it('when the late answer never comes, the next request still goes, once the grace has passed', async () => {
    const { t, sent } = wire();
    const first: Promise<AppsResult<unknown>> = listInstalls(t);
    await vi.advanceTimersByTimeAsync(WRITE_RESPONSE_TIMEOUT_MS);
    await first;
    const second: Promise<AppsResult<unknown>> = listCatalogue(t);
    await vi.advanceTimersByTimeAsync(WRITE_RESPONSE_TIMEOUT_MS);
    expect(sent).toEqual(['ListInstalls', 'ListCatalogue']);
    answer({ Catalogue: { listings: [] } });
    expect(await second).toEqual({ ok: true, value: [] });
  });
});
