/**
 * The ILM messenger handle is what sends ACKs for inbound messages; without it
 * outbound messages block waiting for ACKs that never come. The comment above
 * one call site says so in capitals.
 *
 * All three call sites caught a failure into a `debugLog` — one into a bare
 * `catch (_) { }` — and `debugLog` is stripped from production builds. So a
 * session whose messaging never started produced no toast, no notification, no
 * console line, and no record of any kind, while the login path announced
 * "Login successful — connected to workspace successfully".
 */

import { describe, it, expect, vi  } from 'vitest';
import { startMessagingOrReport, MESSAGING_UNAVAILABLE_TITLE } from '../start-messaging';

describe('starting messaging for a session', () => {
  it('reports true and says nothing when it comes up', async () => {
    const report: ReturnType<typeof vi.fn> = vi.fn();

    const ready: boolean = await startMessagingOrReport('42', {
      start: vi.fn().mockResolvedValue(undefined),
      report,
    });

    expect(ready).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });

  it('tells the user when it does not', async () => {
    const report: ReturnType<typeof vi.fn> = vi.fn();

    const ready: boolean = await startMessagingOrReport('42', {
      start: vi.fn().mockRejectedValue(new Error('handle refused')),
      report,
    });

    expect(ready).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('carries the real reason, not a generic apology', async () => {
    const report: ReturnType<typeof vi.fn> = vi.fn();

    await startMessagingOrReport('42', {
      start: vi.fn().mockRejectedValue(new Error('handle refused')),
      report,
    });

    const [title, detail] = report.mock.calls[0];
    expect(title).toBe(MESSAGING_UNAVAILABLE_TITLE);
    expect(detail).toContain('handle refused');
    // And says what it means for the user, in the terms they experience it.
    expect(detail).toMatch(/sent or received/i);
  });

  it('survives a rejection that is not an Error', async () => {
    const report: ReturnType<typeof vi.fn> = vi.fn();

    const ready: boolean = await startMessagingOrReport('42', {
      start: vi.fn().mockRejectedValue('wasm exploded'),
      report,
    });

    expect(ready).toBe(false);
    expect(report.mock.calls[0][1]).toContain('wasm exploded');
  });

  it('does not swallow the failure into a resolved-looking success', async () => {
    // The shape the old code had: caller could not tell the two apart.
    const succeeded: boolean = await startMessagingOrReport('42', {
      start: vi.fn().mockResolvedValue(undefined),
      report: vi.fn(),
    });
    const failed: boolean = await startMessagingOrReport('42', {
      start: vi.fn().mockRejectedValue(new Error('nope')),
      report: vi.fn(),
    });

    expect(succeeded).not.toBe(failed);
  });
});
