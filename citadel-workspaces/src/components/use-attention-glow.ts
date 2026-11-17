import { useCallback, useRef, useState } from 'react';
import { GLOW_MS, sessionsThatRose } from './unread-rose';

/**
 * Which session chip is lit, and what lights it.
 *
 * Extracted from `useOrphanSessions`, which holds the strip's state and was at
 * its length ceiling. The glow is its own small rule: unread counts arrive as a
 * whole map, a chip lights when its own number goes up, and it goes out on a
 * timer.
 */
export interface AttentionGlow {
  /** The chip to light, or null. */
  glowing: bigint | null;
  /** Feed each unread snapshot; lights whichever session just gained messages. */
  observe: (counts: Map<string, number>) => void;
}

export function useAttentionGlow(): AttentionGlow {
  const [glowing, setGlowing] = useState<bigint | null>(null);
  const previous: React.MutableRefObject<Map<string, number>> = useRef<Map<string, number>>(new Map());
  const timer: React.MutableRefObject<number | undefined> = useRef<number | undefined>(undefined);

  const observe: (counts: Map<string, number>) => void = useCallback(
    (counts: Map<string, number>): void => {
      // One at a time: the strip shows a single glow, and two arrivals in the
      // same tick is a race nobody can see the difference in.
      const first: string | undefined = sessionsThatRose(previous.current, counts)[0];
      previous.current = counts;
      if (first === undefined) return;

      window.clearTimeout(timer.current);
      setGlowing(BigInt(first));
      timer.current = window.setTimeout((): void => setGlowing(null), GLOW_MS);
    },
    [],
  );

  return { glowing, observe };
}
