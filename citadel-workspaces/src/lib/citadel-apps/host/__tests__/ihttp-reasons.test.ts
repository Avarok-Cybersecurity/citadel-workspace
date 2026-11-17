/**
 * The host's cancel reasons and the wire's closed set (E1): every host reason has one wire
 * reason (the Record is exhaustive, so tsc refuses an unmapped one), an app's free text is its
 * own `Caller`, and what an app is handed is the wire reason's word.
 */
import { describe, expect, it } from 'vitest';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { CancelReason } from '../../sdk/wire-generated/CancelReason';
import { appReason, reasonOut, WIRE_WORDS, wireReason, type HostCancelReason } from '../ihttp-reasons';
import { parseRoutes } from '../ihttp-routes';
import { fromWireFrame, toWireFrame } from '../ihttp-wire';

const cancelOut = (reason: string): unknown => toWireFrame({ v: 1, stream: 3n, kind: { Cancel: { reason } } }).kind;

describe('cancel reasons', () => {
  it('an app’s free text crosses as Caller, never as a guess (control: a wire word crosses as itself)', () => {
    expect(cancelOut('done')).toEqual({ Cancel: { reason: 'Caller' } });
    expect(cancelOut('anything else')).toEqual({ Cancel: { reason: 'Caller' } });
    expect(cancelOut('refused')).toEqual({ Cancel: { reason: 'Refused' } });
    expect(cancelOut('protocol')).toEqual({ Cancel: { reason: 'Protocol' } });
  });

  it('each wire reason is read back as its own word, and that word maps to it again', () => {
    for (const [reason, word] of Object.entries(WIRE_WORDS) as [CancelReason, HostCancelReason][]) {
      const back: IhttpFrame | null = fromWireFrame({ v: 1, stream: 3n, kind: { Cancel: { reason } } });
      expect(back?.kind).toEqual({ Cancel: { reason: word } });
      expect(wireReason(word)).toBe(reason);
    }
    expect(Object.keys(WIRE_WORDS)).toHaveLength(11);
  });

  it('what the app is handed for a host fault is the wire’s word, as the relay would hand it', () => {
    expect(appReason('chunk_too_large')).toBe('too_large');
    expect(appReason('unknown_stream')).toBe('protocol');
    expect(appReason('caller_concurrency')).toBe('busy');
    for (const r of Object.keys(reasonOut) as HostCancelReason[]) expect(Object.values(WIRE_WORDS)).toContain(appReason(r));
  });
});

describe('the host’s own paths', () => {
  it('no app may serve a route under /_citadel/ (control: a lookalike segment is the app’s)', () => {
    expect(parseRoutes([{ method: 'GET', path: '/_citadel/version' }], 64, 2048).ok).toBe(false);
    expect(parseRoutes([{ method: 'GET', path: '/_citadel/*' }], 64, 2048).ok).toBe(false);
    expect(parseRoutes([{ method: 'GET', path: '/_citadelx/version' }], 64, 2048).ok).toBe(true);
    expect(parseRoutes([{ method: 'GET', path: '/a/_citadel' }], 64, 2048).ok).toBe(true);
  });
});
