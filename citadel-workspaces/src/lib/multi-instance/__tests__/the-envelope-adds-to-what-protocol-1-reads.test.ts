/**
 * The envelope is additive: a protocol-2 message is a protocol-1 message plus `v`, and a
 * protocol-1 message is still read here. That is what lets a tab of either build proxy its
 * requests through a leader of the other, and take the leader's answers back.
 *
 * The fixtures are messages as the protocol-1 build posts them (fixtures/legacy-v1): every
 * field it sets, with the values' types it uses. The protocol-2 messages are posted by this
 * build's InstanceChannel and captured off a stand-in BroadcastChannel.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { ChannelMessage, ChannelMessageType } from '../channel-types';

/** As the protocol-1 build posts them; values are representative, the shape is exact. */
const PROTOCOL_1: Record<string, Record<string, unknown>> = {
  'outbound-request': { type: 'outbound-request', targetInstanceId: 'leader', senderInstanceId: '1760000000000000001', senderDocumentNonce: 'mabc-1', timestamp: 1, requestId: 'r-1', payload: { GetSessions: { request_id: 'r-1' } } },
  'outbound-ack': { type: 'outbound-ack', targetInstanceId: '1760000000000000001', senderInstanceId: '1760000000000000000', senderDocumentNonce: 'mabc-0', timestamp: 2, requestId: 'r-1', status: 'processed', data: { messengerReady: true } },
  'inbound-forward': { type: 'inbound-forward', targetInstanceId: '1760000000000000001', senderInstanceId: '1760000000000000000', senderDocumentNonce: 'mabc-0', timestamp: 3, requestId: 'f-1', payload: { MessageNotification: { cid: 11n } } },
  'cid-update': { type: 'cid-update', targetInstanceId: '*', senderInstanceId: '1760000000000000001', senderDocumentNonce: 'mabc-1', timestamp: 4, payload: { cid: '11' } },
};

const KNOWN_TO_PROTOCOL_1: ReadonlySet<string> = new Set<string>([
  'type', 'targetInstanceId', 'senderInstanceId', 'senderDocumentNonce', 'timestamp', 'requestId', 'payload', 'status', 'error', 'data',
]);

const posted: ChannelMessage[] = [];
let channel: typeof import('../instance-channel')['instanceChannel'];
let skew: typeof import('../version-skew');

beforeAll(async (): Promise<void> => {
  vi.stubGlobal('BroadcastChannel', class {
    onmessage: unknown = null;
    postMessage(message: ChannelMessage): void { posted.push(structuredClone(message)); }
    addEventListener(): void {}
    close(): void {}
  });
  channel = (await import('../instance-channel')).instanceChannel;
  skew = await import('../version-skew');
});
afterAll((): void => { channel.destroy(); vi.unstubAllGlobals(); });

describe('a protocol-2 message', () => {
  it('carries only the fields protocol 1 knows, plus the envelope', () => {
    channel.send({ type: 'outbound-request', targetInstanceId: 'leader', requestId: 'r-2', payload: { GetSessions: { request_id: 'r-2' } } });
    channel.sendAck('someone-else', 'r-3', { status: 'error', error: 'nope' });
    channel.forwardToInstance('someone-else', { MessageNotification: { cid: 11n } }, 'f-2');

    const types: ChannelMessageType[] = ['outbound-request', 'outbound-ack', 'inbound-forward'];
    for (const type of types) {
      const message: ChannelMessage | undefined = posted.find((m: ChannelMessage) => m.type === type);
      expect(message, type).toBeDefined();
      const extra: string[] = Object.keys(message as ChannelMessage).filter((k: string) => k !== 'v' && !KNOWN_TO_PROTOCOL_1.has(k));
      expect(extra, `${type} has fields protocol 1 has never seen`).toEqual([]);
      expect(message?.v).toMatchObject({ proto: 2, minProto: 2 });
    }
  });

  it('keeps every protocol-1 field it shares with the same type of value', () => {
    channel.send({ type: 'outbound-request', targetInstanceId: 'leader', requestId: 'r-4', payload: { GetSessions: { request_id: 'r-4' } } });
    const mine: ChannelMessage | undefined = posted.filter((m: ChannelMessage) => m.type === 'outbound-request').at(-1);
    for (const [key, value] of Object.entries(PROTOCOL_1['outbound-request'])) {
      expect(typeof (mine as unknown as Record<string, unknown>)[key], key).toBe(typeof value);
    }
  });
});

describe('a protocol-1 message', () => {
  it('is read here, and taken for protocol 1, whatever its type', () => {
    for (const [type, message] of Object.entries(PROTOCOL_1)) {
      expect(skew.admitByVersion(message as unknown as ChannelMessage), type).toBe(true);
    }
  });
});
