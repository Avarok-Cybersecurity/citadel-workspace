/**
 * "N new messages -- View", hung on the bottom edge of the message area like
 * a notch. Shown while the reader is scrolled away from the newest message.
 *
 * The live region is always mounted: a region that appears together with its
 * content is announced unreliably, so only the pill inside it comes and goes.
 * The exit animation needs the pill mounted a moment after the count clears.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ArrowDown } from 'lucide-react';
import { unseenLabel } from '@/lib/chat-scroll/stick';

interface NewMessagesPillProps {
  count: number;
  onView: () => void;
}

/** Matches the notch-out animation (tailwind.config.ts). */
const EXIT_MS: number = 160;

export function NewMessagesPill({ count, onView }: NewMessagesPillProps): JSX.Element {
  const [mounted, setMounted] = useState<boolean>(count > 0);
  const lastCount: MutableRefObject<number> = useRef<number>(count);

  useEffect(() => {
    if (count > 0) {
      lastCount.current = count;
      setMounted(true);
      return undefined;
    }
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => setMounted(false), EXIT_MS);
    return (): void => clearTimeout(timer);
  }, [count]);

  const open: boolean = count > 0;
  return (
    <div
      aria-live="polite"
      data-testid="new-messages-live"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center"
    >
      {mounted && (
        <div
          data-testid="new-messages-pill"
          data-state={open ? 'open' : 'closed'}
          className="pointer-events-auto flex min-h-11 items-center gap-1 rounded-t-2xl border border-b-0 border-border/70 bg-background/80 ps-4 pe-1.5 text-sm text-foreground shadow-[0_-4px_24px_-8px_hsl(var(--foreground)/0.35)] backdrop-blur-xl backdrop-saturate-150 data-[state=open]:animate-notch-in data-[state=closed]:animate-notch-out"
        >
          <span>{unseenLabel(open ? count : lastCount.current)}</span>
          <button
            type="button"
            onClick={onView}
            tabIndex={open ? 0 : -1}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 font-medium text-primary-accent transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
