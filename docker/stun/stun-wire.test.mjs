/**
 * The loopback STUN responder answers as the agent's STUN client (webrtc-rs `stun`) reads it.
 * The expected bytes are RFC 5769's IPv4 response vector (section 2.2), not this file's encoder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindingRequest, bindingRequestId, bindingSuccess, mappedAddress } from './stun-wire.mjs';

const hex = (s) => Uint8Array.from(s.replace(/\s+/g, '').match(/../g).map((b) => parseInt(b, 16)));
const RFC5769_ID = hex('b7e7a701 bc34d686 fa87dfae');
// RFC 5769 section 2.2: XOR-MAPPED-ADDRESS for 192.0.2.1:32853.
const RFC5769_XOR_MAPPED = hex('0020 0008 0001 a147 e112a643');

test('a binding success carries the RFC 5769 XOR-MAPPED-ADDRESS bytes', () => {
  const packet = bindingSuccess(RFC5769_ID, '192.0.2.1', 32853);
  assert.deepEqual(packet.slice(0, 4), hex('0101 000c'));
  assert.deepEqual(packet.slice(4, 8), hex('2112a442'));
  assert.deepEqual(packet.slice(8, 20), RFC5769_ID);
  assert.deepEqual(packet.slice(20), RFC5769_XOR_MAPPED);
});

test('the probe reads back the address the response names', () => {
  const packet = bindingSuccess(RFC5769_ID, '127.0.0.1', 50123);
  assert.deepEqual(mappedAddress(packet, RFC5769_ID), { address: '127.0.0.1', port: 50123 });
  assert.equal(mappedAddress(packet, new Uint8Array(12)), null, 'another transaction is not ours');
});

test('a binding request is answered under its own transaction id', () => {
  assert.deepEqual(bindingRequestId(bindingRequest(RFC5769_ID)), RFC5769_ID);
});

test('anything but a well-formed binding request is ignored', () => {
  const request = bindingRequest(RFC5769_ID);
  const badCookie = request.slice(); badCookie[4] = 0;
  const notRequest = request.slice(); notRequest[1] = 0x11;
  const lying = request.slice(); lying[3] = 4;
  assert.equal(bindingRequestId(request.slice(0, 19)), null);
  assert.equal(bindingRequestId(badCookie), null);
  assert.equal(bindingRequestId(notRequest), null);
  assert.equal(bindingRequestId(lying), null, 'a length the packet does not have');
  assert.equal(bindingRequestId(bindingSuccess(RFC5769_ID, '127.0.0.1', 1)), null, 'a response is not a request');
});

test('only IPv4 sources and real ports are answered', () => {
  assert.throws(() => bindingSuccess(RFC5769_ID, '::1', 1), /only IPv4/);
  assert.throws(() => bindingSuccess(RFC5769_ID, '256.0.0.1', 1), /only IPv4/);
  assert.throws(() => bindingSuccess(RFC5769_ID, '127.0.0.1', 0), /not a UDP port/);
  assert.throws(() => bindingSuccess(new Uint8Array(11), '127.0.0.1', 1), /12 bytes/);
});
