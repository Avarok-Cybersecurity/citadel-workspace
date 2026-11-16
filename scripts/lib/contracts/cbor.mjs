/**
 * Canonical CBOR (RFC 8949 §4.2.1) for the batch-1116 contract fixtures: a strict decoder into the
 * fixtures' JSON model and an encoder back. Decoding then re-encoding must reproduce the bytes,
 * or the fixture is not canonical. No dependencies: the gate runs on a bare checkout.
 *
 * Model: {"$map": [[k, v], …]} for maps, {"$hex": "…"} for byte strings, {"$u64": "decimal"} for
 * integers at or above 2^53, plain numbers, strings, booleans and arrays otherwise.
 */
const MAX_SAFE = 2n ** 53n;

export function hexToBytes(hex) {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error('cbor_hex is not lowercase hex of whole bytes');
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
}
export const bytesToHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Decodes exactly one canonical item spanning all of `bytes`; throws on anything else. */
export function decodeCanonical(bytes) {
  let at = 0;
  const need = (n) => {
    if (at + n > bytes.length) throw new Error(`truncated at byte ${at}`);
  };
  function head() {
    need(1);
    const first = bytes[at++];
    const major = first >> 5;
    const info = first & 31;
    if (info < 24) return { major, n: BigInt(info) };
    const width = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (!width) throw new Error(`indefinite or reserved head 0x${first.toString(16)} at byte ${at - 1}`);
    need(width);
    let n = 0n;
    for (let i = 0; i < width; i++) n = (n << 8n) | BigInt(bytes[at++]);
    const floor = { 1: 24n, 2: 256n, 4: 65536n, 8: 4294967296n }[width];
    if (n < floor) throw new Error(`non-shortest integer head for ${n} at byte ${at - width - 1}`);
    return { major, n };
  }
  function item() {
    const start = at;
    const { major, n } = head();
    switch (major) {
      case 0:
        return n < MAX_SAFE ? Number(n) : { $u64: n.toString() };
      case 2: {
        need(Number(n));
        const out = { $hex: bytesToHex(bytes.subarray(at, at + Number(n))) };
        at += Number(n);
        return out;
      }
      case 3: {
        need(Number(n));
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at, at + Number(n)));
        at += Number(n);
        return text;
      }
      case 4: {
        const items = [];
        for (let i = 0n; i < n; i++) items.push(item());
        return items;
      }
      case 5: {
        const entries = [];
        let previous = null;
        for (let i = 0n; i < n; i++) {
          const keyStart = at;
          const key = item();
          const keyBytes = bytesToHex(bytes.subarray(keyStart, at));
          if (previous !== null && !(previous < keyBytes)) throw new Error(`map keys not sorted (or repeated) at byte ${keyStart}`);
          previous = keyBytes;
          entries.push([key, item()]);
        }
        return { $map: entries };
      }
      case 7:
        if (n === 20n) return false;
        if (n === 21n) return true;
        throw new Error(`simple value ${n} at byte ${start} is not part of any contract`);
      default:
        throw new Error(`major type ${major} at byte ${start} is not part of any contract`);
    }
  }
  const value = item();
  if (at !== bytes.length) throw new Error(`${bytes.length - at} trailing byte(s)`);
  return value;
}

function headBytes(major, n) {
  const m = major << 5;
  if (n < 24n) return [m | Number(n)];
  if (n < 256n) return [m | 24, Number(n)];
  const width = n < 65536n ? 2 : n < 4294967296n ? 4 : 8;
  const out = [m | { 2: 25, 4: 26, 8: 27 }[width]];
  for (let i = width - 1; i >= 0; i--) out.push(Number((n >> BigInt(8 * i)) & 0xffn));
  return out;
}
/** Canonical bytes of a model value. */
export function encodeCanonical(value) {
  if (typeof value === 'boolean') return Uint8Array.of(value ? 0xf5 : 0xf4);
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${value} is not an unsigned integer`);
    return Uint8Array.from(headBytes(0, BigInt(value)));
  }
  if (typeof value === 'string') {
    const utf8 = new TextEncoder().encode(value);
    return Uint8Array.from([...headBytes(3, BigInt(utf8.length)), ...utf8]);
  }
  if (Array.isArray(value)) return concat([Uint8Array.from(headBytes(4, BigInt(value.length))), ...value.map(encodeCanonical)]);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$u64') return Uint8Array.from(headBytes(0, BigInt(value.$u64)));
    if (keys.length === 1 && keys[0] === '$hex') {
      const b = hexToBytes(value.$hex);
      return concat([Uint8Array.from(headBytes(2, BigInt(b.length))), b]);
    }
    if (keys.length === 1 && keys[0] === '$map') {
      const entries = value.$map.map(([k, v]) => [encodeCanonical(k), encodeCanonical(v)]);
      const sorted = [...entries].sort((a, b) => compareBytes(a[0], b[0]));
      for (let i = 1; i < sorted.length; i++) if (compareBytes(sorted[i - 1][0], sorted[i][0]) === 0) throw new Error('a map key repeats');
      return concat([Uint8Array.from(headBytes(5, BigInt(sorted.length))), ...sorted.flat()]);
    }
    throw new Error(`object with keys ${keys.join(',')} is not a model value (plain JSON objects are not CBOR maps here)`);
  }
  throw new Error(`${String(value)} cannot be encoded`);
}
/** A JSON document as the text-keyed canonical map the signed well-known / tray documents use. */
export function jsonToModel(json) {
  if (json === null) throw new Error('null is not part of any signed document');
  if (Array.isArray(json)) return json.map(jsonToModel);
  if (typeof json === 'object') return { $map: Object.entries(json).map(([k, v]) => [k, jsonToModel(v)]) };
  return json;
}
function compareBytes(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
