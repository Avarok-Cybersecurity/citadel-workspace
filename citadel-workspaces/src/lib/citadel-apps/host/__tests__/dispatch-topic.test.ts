/**
 * A publish past the manifest's topic limits is refused by the worker as the app calls, so the
 * SDK's `publish` returns the `Err` (S13): the port answers later, and a later refusal only logs.
 * The dispatcher, the gate and the decision are the production ones; the topic port is a fake
 * that records what reached it.
 */
import { describe, expect, it } from 'vitest';
import { decodeCbor, encodeCbor, type Decoded } from '../cbor';
import type { Capability } from '../capabilities';
import { Dispatcher, type DispatchOutcome } from '../dispatch';
import { IhttpRouter } from '../ihttp-router';
import { directInvoker } from '../invoker';
import { STANDARD_HOST_POLICY } from '../limits';
import type { PortAnswer, TopicPort } from '../ports';
import { TopicGate } from '../topic-sender';
import { ManualClock } from './fakes';

const TOPIC_PUBLISH: number = 2;

async function answer(outcome: DispatchOutcome): Promise<unknown> {
  const decoded: Decoded = decodeCbor('now' in outcome ? outcome.now : await outcome.later);
  if (!decoded.ok) throw new Error('reply is not CBOR');
  return decoded.value;
}

function rig(gate: TopicGate | null): { d: Dispatcher; reached: number[]; clock: ManualClock } {
  const reached: number[] = [];
  const clock: ManualClock = new ManualClock();
  const topic: TopicPort = {
    TopicOpen: async () => ({ ok: { name: 'pool', members: [] } }),
    TopicPublish: async ({ body }: { name: string; body: Uint8Array }): Promise<PortAnswer<null>> => { reached.push(body.byteLength); return { ok: null }; },
    TopicClose: () => ({ ok: null }),
    onEvent: () => (): void => undefined,
  };
  const d: Dispatcher = new Dispatcher({
    granted: new Set<Capability>(['group.topic.publish']), policy: STANDARD_HOST_POLICY, clock, invoker: directInvoker({ topic }),
    router: new IhttpRouter('net.avarok.x', STANDARD_HOST_POLICY.ihttp, null), pageUrl: 'https://work.avarok.net/', routerActions: (): void => {}, topics: gate,
  });
  return { d, reached, clock };
}

const publish = (d: Dispatcher, n: number): DispatchOutcome => d.call('topic', TOPIC_PUBLISH, encodeCbor({ name: 'pool', body: new Uint8Array(n) }));

describe('topic limits, answered as the app publishes', () => {
  it('the third message in one second is refused now, and never reaches the port (control: a second later it is sent)', async () => {
    const { d, reached, clock } = rig(new TopicGate({ max_msg_bytes: 8, max_msgs_per_s: 2 }));
    expect(await answer(publish(d, 1))).toEqual({ ok: null });
    expect(await answer(publish(d, 1))).toEqual({ ok: null });
    const third: DispatchOutcome = publish(d, 1);
    expect(third).toHaveProperty('now');
    expect(await answer(third)).toEqual({ refused: { limit: 'topic_rate' } });
    clock.advance(1000);
    expect(await answer(publish(d, 1))).toEqual({ ok: null });
    expect(reached).toEqual([1, 1, 1]);
  });

  it('a body past max_msg_bytes is refused now (control: exactly at it is sent)', async () => {
    const { d, reached } = rig(new TopicGate({ max_msg_bytes: 8, max_msgs_per_s: 4 }));
    const over: DispatchOutcome = publish(d, 9);
    expect(over).toHaveProperty('now');
    expect(await answer(over)).toEqual({ refused: { limit: 'topic_bytes' } });
    expect(await answer(publish(d, 8))).toEqual({ ok: null });
    expect(reached).toEqual([8]);
  });
});
