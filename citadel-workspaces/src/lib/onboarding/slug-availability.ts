/**
 * "Is this address free?", asked as the visitor types.
 *
 * Debounced so a name typed at speed costs one request, not one per keystroke,
 * and each new question aborts the last so a slow answer to an old slug cannot
 * overwrite the answer to the current one.
 *
 * `availabilityFromAnswer` is the one place a control-plane answer becomes
 * something the page acts on. Only `available: true` may continue; every other
 * answer -- including one with a reason this page has never heard of -- blocks.
 */
import { useEffect, useState } from 'react';
import { checkSlugShape, describeSlugProblem, type SlugShape } from './slug';
import { ControlPlaneError, type ControlPlane, type SlugAvailability } from './control-plane-client';

export type Availability =
  | { readonly state: 'idle' }
  | { readonly state: 'invalid'; readonly message: string }
  | { readonly state: 'checking' }
  | { readonly state: 'available' }
  | { readonly state: 'unavailable'; readonly message: string }
  | { readonly state: 'error'; readonly message: string };

export const SLUG_CHECK_DEBOUNCE_MS: number = 350;

export function availabilityFromAnswer(slug: string, answer: SlugAvailability): Availability {
  if (answer.available) return { state: 'available' };
  switch (answer.reason) {
    case 'taken':
      return { state: 'unavailable', message: `${slug} is already taken. Try another.` };
    case 'reserved':
      return { state: 'unavailable', message: `${slug} is reserved. Try another.` };
    case 'invalid':
      return { state: 'unavailable', message: 'That address is not allowed. Try another.' };
    case undefined:
      return { state: 'unavailable', message: `${slug} is not available. Try another.` };
  }
}

export function canContinueWith(availability: Availability): boolean {
  return availability.state === 'available';
}

function errorMessage(error: unknown): string {
  return error instanceof ControlPlaneError ? error.message : 'Could not check that address.';
}

export function useSlugAvailability(api: ControlPlane, slug: string): Availability {
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });

  useEffect(() => {
    if (slug.length === 0) {
      setAvailability({ state: 'idle' });
      return undefined;
    }
    const shape: SlugShape = checkSlugShape(slug);
    if (!shape.ok) {
      setAvailability({ state: 'invalid', message: describeSlugProblem(shape.problem) });
      return undefined;
    }

    setAvailability({ state: 'checking' });
    const controller: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      api.checkSlug(slug, controller.signal).then(
        (answer: SlugAvailability) => {
          if (!controller.signal.aborted) setAvailability(availabilityFromAnswer(slug, answer));
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setAvailability({ state: 'error', message: errorMessage(error) });
        },
      );
    }, SLUG_CHECK_DEBOUNCE_MS);

    return (): void => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, slug]);

  return availability;
}
