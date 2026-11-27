/**
 * The console ring holds redacted, bounded lines and folds repeats; a breadcrumb is a kind only,
 * never a field or a value.
 */
import { describe, expect, it } from 'vitest';
import { ConsoleRing, type RingLine } from '../ring';
import { kindOf } from '../breadcrumbs';

describe('ConsoleRing', () => {
  it('redacts, folds a repeated line, and keeps only the newest lines', () => {
    const ring: ConsoleRing = new ConsoleRing(2, (): number => 0);
    ring.record('error', ['failed https://x.example/a?t=1']);
    ring.record('error', ['failed https://x.example/a?t=1']);
    ring.record('warn', ['second']);
    ring.record('warn', ['third']);
    const lines: readonly RingLine[] = ring.snapshot();
    expect(lines.map((l) => l.message)).toEqual(['second', 'third']);
    const folded: ConsoleRing = new ConsoleRing(5, (): number => 0);
    folded.record('error', ['failed https://x.example/a?t=1']);
    folded.record('error', ['failed https://x.example/a?t=1']);
    expect(folded.snapshot()).toEqual([{ at: 0, source: 'ConsoleError', message: 'failed <url>', stack: null, repeats: 2 }]);
  });

  it('refuses a limit that is not a positive whole number', () => {
    expect(() => new ConsoleRing(0, (): number => 0)).toThrow();
  });
});

describe('kindOf', () => {
  it('names the variant and a sub-variant, never a field or its value', () => {
    expect(kindOf({ Telemetry: { GetMyConsent: null } })).toBe('Telemetry.GetMyConsent');
    expect(kindOf({ AdminRequests: 'Take' })).toBe('AdminRequests.Take');
    expect(kindOf({ SendMessage: { text: 'secret', peer: 5 } })).toBe('SendMessage');
    expect(kindOf('Waiting')).toBe('Waiting');
  });
});
