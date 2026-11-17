/**
 * An error toast must be announced, and must be findable.
 *
 * Sonner renders every toast inside one `aria-live="polite"` region, so an
 * error waited for the user to pause before being read — and an error that
 * blocks the action they just took is exactly the case for `assertive`. The app
 * already uses `role="alert"` for the equivalent inline errors.
 *
 * It also closes a trap this repository fell into twice while writing the
 * agent-down checks, and had already written down: a Sonner toast carries no
 * `role="alert"`, so an assertion looking for one reports "the app said
 * nothing" about an app that said exactly the right thing. Documenting it did
 * not stop it happening again; making the selector true does.
 */
import { describe, it, expect, vi, beforeEach  } from 'vitest';
import { isValidElement } from 'react';

const sonner: {
  error: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  plain: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => ({
  error: vi.fn((_message: unknown, _opts?: unknown) => 1),
  success: vi.fn((_message: unknown, _opts?: unknown) => 2),
  plain: vi.fn((_message: unknown, _opts?: unknown) => 3),
  dismiss: vi.fn(),
}));
vi.mock('sonner', () => {
  const toast: ReturnType<typeof Object.assign> = Object.assign(sonner.plain, {
    error: sonner.error,
    success: sonner.success,
    dismiss: sonner.dismiss,
  });
  return { toast };
});

import { toast } from '../use-toast';

/** The role on the DESCRIPTION Sonner was handed, if any. */
function roleOf(call: unknown[] | undefined): string | undefined {
  const description: unknown = (call?.[1] as { description?: unknown } | undefined)?.description;
  return isValidElement(description)
    ? (description.props as { role?: string }).role
    : undefined;
}

describe('toast', () => {
  beforeEach(() => {
    sonner.error.mockClear();
    sonner.success.mockClear();
    sonner.plain.mockClear();
  });

  it('announces an error assertively', () => {
    toast({ title: 'Connection Error', description: 'no agent', variant: 'destructive' });
    expect(sonner.error).toHaveBeenCalled();
    expect(roleOf(sonner.error.mock.calls[0])).toBe('alert');
  });

  it('does not interrupt for a success', () => {
    // The positive control. Wrapping everything in role="alert" would satisfy
    // "errors are announced" and be its own bug: a screen-reader user would be
    // interrupted by every confirmation the app produces.
    toast({ title: 'Saved', description: 'all good', variant: 'success' });
    expect(roleOf(sonner.success.mock.calls[0])).toBeUndefined();
  });

  it('does not interrupt for a neutral toast', () => {
    toast({ title: 'Copied', description: 'to clipboard' });
    expect(roleOf(sonner.plain.mock.calls[0])).toBeUndefined();
  });

  it('keeps the headline a plain string, so Sonner still renders the description', () => {
    // The first attempt wrapped the HEADLINE. Sonner renders no description
    // when its message is a ReactNode, so the toast shrank to "Connection
    // Error" and dropped the sentence telling the user what to do.
    toast({ title: 'Connection Error', description: 'no agent', variant: 'destructive' });
    expect(sonner.error.mock.calls[0][0]).toBe('Connection Error');
    expect(roleOf(sonner.error.mock.calls[0])).toBe('alert');
  });

  it('adds nothing when there is no description to announce', () => {
    toast({ title: 'Connection Error', variant: 'destructive' });
    expect((sonner.error.mock.calls[0][1] as { description?: unknown }).description).toBeUndefined();
  });
});
