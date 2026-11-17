/**
 * The stage says which status a call is in and not how long it has been there,
 * and that is the difference between "the connect deadline never armed" and
 * "the call keeps re-entering connecting". A CI run spent three attempts
 * unable to tell those apart.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStatusSince } from '../use-status-since';
import type { CallStatus } from '@/lib/call/call-state';

describe('when the call last entered its status', () => {
  it('holds still while the status does', () => {
    let now: number = 1_000;
    const { result, rerender } = renderHook(
      ({ status }: { status: CallStatus }) => useStatusSince(status, () => now),
      { initialProps: { status: 'connecting' as CallStatus } },
    );

    expect(result.current).toBe(1_000);
    now = 9_000;
    rerender({ status: 'connecting' as CallStatus });
    expect(result.current).toBe(1_000);
  });

  it('moves when the status does', () => {
    // The negative control: without this, returning a constant would pass the
    // test above.
    let now: number = 1_000;
    const { result, rerender } = renderHook(
      ({ status }: { status: CallStatus }) => useStatusSince(status, () => now),
      { initialProps: { status: 'ringing-in' as CallStatus } },
    );

    now = 4_500;
    rerender({ status: 'connecting' as CallStatus });
    expect(result.current).toBe(4_500);
  });

  it('moves again when the status returns to one it held before', () => {
    // The case this exists to detect: a call that re-enters `connecting` looks
    // identical to one that never left, and only the timestamp differs.
    let now: number = 1_000;
    const { result, rerender } = renderHook(
      ({ status }: { status: CallStatus }) => useStatusSince(status, () => now),
      { initialProps: { status: 'connecting' as CallStatus } },
    );

    now = 2_000;
    rerender({ status: 'active' as CallStatus });
    now = 3_000;
    rerender({ status: 'connecting' as CallStatus });
    expect(result.current).toBe(3_000);
  });
});
