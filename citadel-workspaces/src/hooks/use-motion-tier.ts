/**
 * How much script-driven motion may run: 'full', 'lite' or 'off' (lib/motion-tier.ts).
 *
 * The document's classes say what the app chose (motion-state writes them,
 * from the Animations setting, the device and the frame probe); the OS asking
 * for reduced motion makes it off on top, live. index.css honours the same pair
 * for CSS motion, so script and CSS motion stop for the same reasons. Read
 * every time the root's classes change, so a downgrade mid-session reaches a
 * tree already mounted.
 */
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { documentMotionTier } from '@/lib/motion-state';
import { motionTier, type MotionTier } from '@/lib/motion-tier';

export function useMotionTier(): MotionTier {
  const osReduces: boolean | null = useReducedMotion();
  const [chosen, setChosen] = useState<MotionTier>(documentMotionTier);
  useEffect((): (() => void) => {
    const observer: MutationObserver = new MutationObserver((): void => setChosen(documentMotionTier()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setChosen(documentMotionTier());
    return (): void => observer.disconnect();
  }, []);
  return motionTier(chosen, osReduces === true);
}
