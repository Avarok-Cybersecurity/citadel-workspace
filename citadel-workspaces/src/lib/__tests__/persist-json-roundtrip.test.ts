/**
 * Bigints must survive storage, or every `===` downstream silently stops
 * matching.
 *
 * Two stores persisted with `safeJSONStringify` — whose own contract is
 * logging/display — and read back with a bare `JSON.parse`. Fields typed
 * `bigint` came back as strings, and `"123" === 123n` is false. After any
 * reload that made incoming peer requests invisible to the list and the badge,
 * outgoing ones impossible to dedupe or remove (so they grew forever and
 * re-sent), and a stored session's cid useless for reclaiming its orphan.
 */
import { describe, it, expect } from 'vitest';
import { persistJSON, parsePersistedJSON, safeJSONStringify } from '../storage-utils';

describe('bigints survive being persisted', () => {
  it('round-trips a bigint as a bigint', () => {
    const round: { cid: bigint; } = parsePersistedJSON<{ cid: bigint }>(persistJSON({ cid: 123n }));
    expect(round.cid).toBe(123n);
    expect(typeof round.cid).toBe('bigint');
  });

  it('keeps strings that merely look numeric as strings', () => {
    // The reason for tagging rather than guessing: a username of "42" must not
    // become a bigint.
    const round: { name: string; } = parsePersistedJSON<{ name: string }>(persistJSON({ name: '42' }));
    expect(round.name).toBe('42');
  });

  it('round-trips bigints nested in arrays', () => {
    const round: { rows: Array<{ toCid: bigint; }>; } = parsePersistedJSON<{ rows: Array<{ toCid: bigint }> }>(
      persistJSON({ rows: [{ toCid: 7n }, { toCid: 8n }] }),
    );
    expect(round.rows.map((r) => r.toCid)).toEqual([7n, 8n]);
  });

  it('leaves an untagged digit string a string: bare strings from earlier builds are not rescued', () => {
    const earlier: string = safeJSONStringify({ toCid: 9n, note: '9' });
    const round: { toCid: unknown; note: string; } = parsePersistedJSON<{ toCid: unknown; note: string }>(earlier);
    expect(round.toCid).toBe('9');
    expect(round.note).toBe('9');
  });

  it('demonstrates why: the old pair produced a value that compares false', () => {
    const wrong: { cid: unknown; } = JSON.parse(safeJSONStringify({ cid: 123n })) as { cid: unknown };
    expect(wrong.cid).not.toBe(123n);
    expect(wrong.cid === 123n).toBe(false);
  });
});
