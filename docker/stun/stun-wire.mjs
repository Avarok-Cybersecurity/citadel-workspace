/**
 * The STUN (RFC 5389) binding exchange, as bytes. Pure: no sockets, no clock.
 *
 * The dev and CI stack's agent learns its NAT from three STUN servers. Public ones made
 * the verdict the runner's: one VM's NAT read as unpredictable, the server stamped no
 * Direct path for any pair, no UDP channel was ever offered, and every call failed on
 * that VM while the same commit passed on another. Three loopback responders built
 * from this file answer with the address each probe really came from, so every run
 * sees the same machine and the same verdict. Production keeps its public servers.
 */

export const MAGIC_COOKIE = 0x2112a442;
const HEADER_BYTES = 20;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const XOR_MAPPED_ADDRESS = 0x0020;
const FAMILY_IPV4 = 0x01;

/** The transaction id of a well-formed binding request, or null for anything else. */
export function bindingRequestId(packet) {
  if (!(packet instanceof Uint8Array) || packet.length < HEADER_BYTES) return null;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const type = view.getUint16(0);
  const length = view.getUint16(2);
  if (type !== BINDING_REQUEST) return null;
  if (view.getUint32(4) !== MAGIC_COOKIE) return null;
  if (length % 4 !== 0 || HEADER_BYTES + length !== packet.length) return null;
  return packet.slice(8, HEADER_BYTES);
}

/** A binding success answering `transactionId`, naming `address:port` as XOR-MAPPED-ADDRESS. */
export function bindingSuccess(transactionId, address, port) {
  if (!(transactionId instanceof Uint8Array) || transactionId.length !== 12) {
    throw new Error('a STUN transaction id is 12 bytes');
  }
  if (!Number.isInteger(port) || port < 1 || port > 0xffff) throw new Error(`not a UDP port: ${port}`);
  const octets = ipv4Octets(address);
  const packet = new Uint8Array(HEADER_BYTES + 12);
  const view = new DataView(packet.buffer);
  view.setUint16(0, BINDING_SUCCESS);
  view.setUint16(2, 12);
  view.setUint32(4, MAGIC_COOKIE);
  packet.set(transactionId, 8);
  view.setUint16(20, XOR_MAPPED_ADDRESS);
  view.setUint16(22, 8);
  view.setUint8(24, 0);
  view.setUint8(25, FAMILY_IPV4);
  view.setUint16(26, port ^ (MAGIC_COOKIE >>> 16));
  view.setUint32(28, (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) ^ MAGIC_COOKIE) >>> 0);
  return packet;
}

/** The address and port a binding success names, for the responder's own health probe. */
export function mappedAddress(packet, transactionId) {
  if (!(packet instanceof Uint8Array) || packet.length !== HEADER_BYTES + 12) return null;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint16(0) !== BINDING_SUCCESS || view.getUint32(4) !== MAGIC_COOKIE) return null;
  if (!packet.slice(8, HEADER_BYTES).every((byte, i) => byte === transactionId[i])) return null;
  if (view.getUint16(20) !== XOR_MAPPED_ADDRESS || view.getUint8(25) !== FAMILY_IPV4) return null;
  const ip = (view.getUint32(28) ^ MAGIC_COOKIE) >>> 0;
  return { address: [ip >>> 24, (ip >>> 16) & 0xff, (ip >>> 8) & 0xff, ip & 0xff].join('.'), port: view.getUint16(26) ^ (MAGIC_COOKIE >>> 16) };
}

/** A binding request with `transactionId`. */
export function bindingRequest(transactionId) {
  const packet = new Uint8Array(HEADER_BYTES);
  const view = new DataView(packet.buffer);
  view.setUint16(0, BINDING_REQUEST);
  view.setUint16(2, 0);
  view.setUint32(4, MAGIC_COOKIE);
  packet.set(transactionId, 8);
  return packet;
}

function ipv4Octets(address) {
  const parts = String(address).split('.');
  const octets = parts.map(Number);
  if (parts.length !== 4 || !octets.every((o, i) => /^\d{1,3}$/.test(parts[i]) && o <= 255)) {
    throw new Error(`only IPv4 is answered (the agent probes over IPv4): ${address}`);
  }
  return octets;
}
