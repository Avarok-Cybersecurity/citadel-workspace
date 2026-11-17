import { CitadelLogo } from '@/components/brand/CitadelLogo';

/**
 * Shown while a lazily-loaded route chunk is in flight.
 *
 * Kept intentionally quiet: route chunks usually resolve in a few hundred
 * milliseconds, and a spinner that appears and vanishes that fast reads as a
 * flicker. The `animate-in fade-in` delay means a fast navigation shows nothing
 * at all, while a genuinely slow one (cold cache, poor connection) still gets
 * visible feedback instead of a blank frame.
 */
export function RouteFallback(): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-dvh items-center justify-center bg-background"
    >
      <div className="flex flex-col items-center gap-4 opacity-0 animate-in fade-in duration-300 delay-300 fill-mode-forwards">
        {/* Decorative: the live region below already announces "Loading". */}
        <CitadelLogo variant="mark" height={40} />
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary"
          aria-hidden="true"
        />
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}
