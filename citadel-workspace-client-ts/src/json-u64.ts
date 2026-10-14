/**
 * JSON that carries every u64 exactly.
 *
 * serde_json writes a u64 as a bare JSON number, and JSON.parse turns every
 * number into a double before any reviver sees it, so a value above
 * Number.MAX_SAFE_INTEGER was already wrong by the time a codec could look at
 * it. Account ids are random 63-bit values, so a peer CID lost its low bits on
 * every read.
 *
 * Both directions keep the wire format serde expects (bare numbers). A random
 * per-call marker protects the digits while JSON.stringify/JSON.parse run, and
 * because the marker is unguessable, no string the data already holds can be
 * mistaken for one.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function freshMarker(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `u64:${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}:`;
}

/** JSON.stringify, with every bigint written as a bare integer of exactly its value. */
export function stringifyWithU64(value: unknown): string {
  const marker = freshMarker();
  const json = JSON.stringify(value, (_key, field: unknown) =>
    typeof field === 'bigint' ? `${marker}${field.toString()}` : field
  );
  return json.split(`"${marker}`).map((part, index) => {
    if (index === 0) return part;
    const end = part.indexOf('"');
    return part.slice(0, end) + part.slice(end + 1);
  }).join('');
}

function isUnsafeInteger(literal: string): boolean {
  if (!/^-?\d+$/.test(literal)) return false;
  const value = BigInt(literal);
  return value > MAX_SAFE || value < -MAX_SAFE;
}

/** Quote each integer literal outside a string that a double cannot hold, prefixed by `marker`. */
function protectUnsafeIntegers(text: string, marker: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const literal = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i))?.[0] ?? ch;
      out += isUnsafeInteger(literal) ? `"${marker}${literal}"` : literal;
      i += literal.length;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * JSON.parse in which every field `isU64Field` names becomes a bigint holding
 * its exact value. An unsafe integer anywhere else, or a non-integer in a u64
 * field, throws: either would otherwise be returned silently changed.
 */
export function parseWithU64(text: string, isU64Field: (key: string) => boolean): unknown {
  const marker = freshMarker();
  return JSON.parse(protectUnsafeIntegers(text, marker), (key, value: unknown) => {
    const protectedDigits =
      typeof value === 'string' && value.startsWith(marker) ? value.slice(marker.length) : null;
    if (protectedDigits !== null) {
      if (!isU64Field(key)) {
        throw new RangeError(
          `JSON field "${key}" holds ${protectedDigits}, which is not a u64 field and does not fit in a number.`
        );
      }
      return BigInt(protectedDigits);
    }
    if (isU64Field(key) && typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new RangeError(`u64 field "${key}" arrived as ${value}, which is not an integer.`);
      }
      return BigInt(value);
    }
    return value;
  });
}
