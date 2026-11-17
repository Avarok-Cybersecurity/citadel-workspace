/**
 * The boxes around the focused tree's rows, shaped so that they never fight the rows' glide (see
 * tree-motion): none of them changes size in the flow while the rows move, except the outermost, which
 * carries what sits below the tree. In lite none of them animates its size or position at all.
 */
import { forwardRef, useLayoutEffect, useRef, useState, type ForwardedRef, type ForwardRefExoticComponent, type ReactNode, type RefAttributes, type RefObject } from 'react';
import { animate, motion, useMotionValue, type MotionValue } from 'framer-motion';
import { cn } from '@/lib/utils';
import { AnimatePresence, FadeOnLeave, GLIDE, keepInScript, PresenceScope, useFadeOut, useTreeTier } from './tree-motion';

/**
 * A box whose height follows its contents smoothly. Everything inside reaches
 * its final layout at once and glides there by FLIP, but FLIP moves only what
 * carries a layout id: when the tree grows or shrinks, everything BELOW it in
 * the sidebar would jump by the difference. Animating this box's height with
 * the glide's timing carries them along.
 */
export function AutoHeight({ children }: { children: ReactNode }): JSX.Element {
  // Only at full: lite animates no height, and off animates nothing.
  return useTreeTier() === 'full' ? <MeasuredHeight>{children}</MeasuredHeight> : <div className="relative">{children}</div>;
}

/**
 * Without motion the box is simply its contents' height; measuring would only make it a frame late. The
 * height is driven straight from the observer, not through a render, which would start it frames after the
 * rows it has to keep pace with.
 */
function MeasuredHeight({ children }: { children: ReactNode }): JSX.Element {
  const inner: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const height: MotionValue<number | string> = useMotionValue<number | string>('auto');
  useLayoutEffect((): (() => void) | void => {
    const el: HTMLDivElement | null = inner.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    height.set(el.offsetHeight);
    const observer: ResizeObserver = new ResizeObserver((): void => { animate(height, el.offsetHeight, GLIDE); });
    observer.observe(el);
    return (): void => observer.disconnect();
  }, [height]);
  return (
    <motion.div className="overflow-hidden" style={{ height }}>
      {/* Positioned: what popLayout lifts out of the flow is placed against this. */}
      <div ref={inner} className="relative">{children}</div>
    </motion.div>
  );
}

/**
 * The ancestor stack's box. It fades out where it stands when the stack goes (popped out of the flow, so
 * the rows below take their places at once and glide there). Its tint and outline are a layer of their own
 * that resizes by FLIP with the rows, and that layer alone fades in when a stack appears: the rows gliding
 * into it are already on screen and must not blink.
 */
export const StackBox: ForwardRefExoticComponent<{ children: ReactNode } & RefAttributes<HTMLLIElement>> = forwardRef<HTMLLIElement, { children: ReactNode }>(
  function StackBox({ children }: { children: ReactNode }, ref: ForwardedRef<HTMLLIElement>): JSX.Element {
    return (
      <motion.li ref={ref} role="none" data-testid="tree-ancestor-stack" className="relative mb-2 border border-transparent p-1" style={{ opacity: useFadeOut() }}>
        <motion.div
          aria-hidden="true"
          layout={useTreeTier() !== 'lite'}
          className="absolute -inset-px border border-primary-accent/35 bg-primary-accent/10"
          style={{ borderRadius: 7 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
        <PresenceScope>{children}</PresenceScope>
      </motion.li>
    );
  },
);

/**
 * A list that becomes a scroll container only once it is taller than its cap. A scroll container clips,
 * and rows gliding into the list from the stack above would be cut at its edge on the way in.
 */
export function ScrollWhenTall({ children }: { children: ReactNode }): JSX.Element {
  const box: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState<boolean>(false);
  useLayoutEffect((): (() => void) | void => {
    const el: HTMLDivElement | null = box.current;
    const content: Element | null = el?.firstElementChild ?? null;
    if (!el || !(content instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => setScrolls(content.offsetHeight > el.clientHeight + 0.5);
    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(content);
    measure();
    return (): void => observer.disconnect();
  }, []);
  return <motion.div ref={box} layoutScroll className={cn('max-h-[60vh]', scrolls && 'overflow-y-auto')}>{children}</motion.div>;
}

/** A list item that fades out where it stands when the presence it is in removes it. */
export const FadingItem: ForwardRefExoticComponent<{ children: ReactNode } & RefAttributes<HTMLLIElement>> = forwardRef<HTMLLIElement, { children: ReactNode }>(
  function FadingItem({ children }: { children: ReactNode }, ref: ForwardedRef<HTMLLIElement>): JSX.Element {
    return <motion.li ref={ref} role="none" style={{ opacity: useFadeOut() }}>{children}</motion.li>;
  },
);

/**
 * Contents that unfold and fold. The list takes its full height at once -- so
 * every row below glides to its true place -- and is uncovered from the top as
 * they move away: the curtain's edge and the row below it share one timing, so
 * neither is drawn over the other. `id` keys the
 * presence, so a different node's children replace these by folding rather
 * than by being swapped in place.
 *
 * A row that has just mounted (it moved here from another list) shows its
 * children without a curtain: one of them may be gliding in from above, and
 * would be cut. Those children arrive one by one instead.
 *
 * Lite has no curtain: the list is simply there, and its rows fade in as every arriving row does.
 */
// The top and sides reach far past the list, so a row gliding in from above is never cut; the bottom is the
// curtain. At rest there is no clip at all: a row gliding in from below, or a focus ring, is not cut either.
const SHUT: string = 'inset(-100vh -100vw 100% -100vw)';
const OPEN: string = 'inset(-100vh -100vw 0% -100vw)';

export function Unfold({ open, id, children }: { open: boolean; id: string; children: ReactNode }): JSX.Element {
  const lite: boolean = useTreeTier() === 'lite';
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {open && lite && (
        <motion.div key={id}>
          <FadeOnLeave>
            <PresenceScope>{children}</PresenceScope>
          </FadeOnLeave>
        </motion.div>
      )}
      {open && !lite && (
        <motion.div
          key={id}
          layout="position"
          initial={{ clipPath: SHUT, opacity: 0 }}
          animate={{ clipPath: OPEN, opacity: 1, transitionEnd: { clipPath: 'none' } }}
          exit={{ clipPath: [OPEN, SHUT] }}
          onUpdate={keepInScript}
        >
          <FadeOnLeave>
            <PresenceScope>{children}</PresenceScope>
          </FadeOnLeave>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
