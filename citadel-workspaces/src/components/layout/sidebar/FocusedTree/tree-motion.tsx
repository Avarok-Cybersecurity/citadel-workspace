/**
 * The focused tree's motion: nothing in it jumps, and a change of level reads
 * as one move.
 *
 * Selecting a node moves rows between three lists -- a child becomes a sibling,
 * a sibling becomes an ancestor -- and each list is its own <ul>, so React
 * mounts a new element for the row in its new place. Every row's LINE (the
 * treeitem, not the <li> around it and its children) carries its node id as a
 * framer `layoutId`, so the new line starts where the old one was and glides
 * (FLIP); `layout="position"` moves it without scaling it, because a 22px
 * ancestor row and a 30px sibling row would otherwise squash their text on the
 * way. The two copies cross-fade as they go. It is the line alone that
 * cross-fades: on the <li>, the fade would carry the moved row's whole unfolded
 * list in with it, drawn over whatever is still leaving where the list lands.
 *
 * Nothing inside the tree changes size in the flow while it moves. Every box
 * takes its final size at once, so each glide is measured against the layout
 * it really lands in: a box shrinking by height underneath a FLIP keeps
 * shoving the row it is gliding to a target that is no longer there. So a row
 * or list that goes is popped out of the flow and fades where it stands
 * (AnimatePresence `popLayout`); an unfolding list is uncovered by a curtain
 * that keeps pace with the rows gliding out of its way; and the one box that
 * follows by height is the whole tree's (AutoHeight), so what sits below it in
 * the sidebar is carried, not jumped.
 *
 * Leaving, moving and arriving are sequenced. What leaves fades at once; what
 * moves is visible throughout (a row that was on screen before does not fade
 * in again); what arrives fades in late, finishing with the glide -- so nothing
 * arriving is drawn at strength over something still leaving or passing.
 *
 * Durations come from MOTION_SECONDS and are applied once, here, through
 * MotionConfig; no element sets its own, so switching motion off is one switch.
 * It is off -- every duration zero, transforms not animated at all -- when the
 * OS asks for reduced motion or the user turned Animations off.
 *
 * Lite (useMotionTier: a slow device under Auto, or chosen) is the cheap middle:
 * no FLIP, no layoutId, no curtain and no height -- nothing measured or
 * projected. What leaves goes at once and what arrives fades in over
 * MOTION_SECONDS.fade, so nothing arriving is ever drawn over something leaving:
 * without a glide to carry them apart, the two would share the same place.
 *
 * A row that is leaving stays in the DOM for its fade, while its replacement is
 * already mounted in the new list. For those few frames the same node would be
 * on screen twice: two `tree-node-<id>`s for a spec to trip over, two treeitems
 * for a screen reader, two buttons for a click. So a leaving row -- or any row
 * inside something leaving, which framer's own presence does not report --
 * drops its testid and role, hides from assistive tech and takes no pointer.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type Context, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, animate, motion, useIsPresent, useMotionValue, usePresence, type AnimationPlaybackControls, type MotionValue, type Transition } from 'framer-motion';
import { MOTION_SECONDS } from '@/lib/motion';
import { useMotionTier } from '@/hooks/use-motion-tier';
import type { MotionTier } from '@/lib/motion-tier';

export const GLIDE: Transition = { duration: MOTION_SECONDS.layout, ease: [0.2, 0, 0, 1] };
// An unfolding list's curtain is part of the same move as the rows' glide, so it takes the glide's timing.
// Fades default to leaving: steep at first, so what goes is mostly gone before anything gliding past reaches it.
const MOVING: Transition = { duration: MOTION_SECONDS.leave, ease: 'circOut', layout: GLIDE, clipPath: GLIDE };
const STILL: Transition = { duration: 0, layout: { duration: 0 } };
// Arriving finishes with the glide. An inline transition outranks MotionConfig's, so it is only ever set with motion on.
const ARRIVE: Transition = { duration: MOTION_SECONDS.fade, delay: MOTION_SECONDS.layout - MOTION_SECONDS.fade, ease: 'easeIn' };
// Lite: opacity alone, at the fade's timing; framer's reduced-motion mode drops any transform still asked for.
const LITE: Transition = { duration: MOTION_SECONDS.fade, ease: 'easeOut', layout: { duration: 0 } };
const CONFIG: Record<MotionTier, { reducedMotion: 'never' | 'always'; transition: Transition }> = {
  full: { reducedMotion: 'never', transition: MOVING },
  lite: { reducedMotion: 'always', transition: LITE },
  off: { reducedMotion: 'always', transition: STILL },
};

/**
 * The classes SidebarMenuItem gives its <li>, for the `motion.li` rows that
 * stand in for it: `group/menu-item` is what SidebarMenuButton's variants key on.
 */
export const ITEM_CLASS: string = 'group/menu-item relative';

/**
 * Fading out is driven from script, not handed to the browser. framer gives an opacity to WAAPI unless
 * something reads it every frame, and measured in Chromium a WAAPI fade snapped back to full opacity for
 * the frame between finishing and the element unmounting: a flash of everything that had just faded.
 */
export const keepInScript = (): void => {};

/** The search/tree swap's fade; inside the tree, what leaves fades by useFadeOut. */
export const FADE_OUT: { readonly exit: { readonly opacity: number }; readonly onUpdate: () => void } = { exit: { opacity: 0 }, onUpdate: keepInScript };

/** A row's <li>: carries its line and its unfolded list when it moves within its list (and fades by useFadeOut). Lite: stays put. */
export function useRowItem(): { readonly layout?: 'position' } {
  return useTreeMotion().tier === 'lite' ? {} : { layout: 'position' };
}

const LEAVE: Transition = { duration: MOTION_SECONDS.leave, ease: 'circOut' };

/**
 * The opacity of something that fades out where it stands when it goes, for its `style`. Not an `exit` prop:
 * framer starts an element's own animation on the first frame it runs, but the glides from the commit -- so
 * after a long commit (61ms to first paint at 4x CPU throttle, measured) the rows were already a third of the
 * way along while everything leaving was still fully opaque under them. A free-standing value animated from
 * the commit starts on the same clock as the glides.
 */
export function useFadeOut(): MotionValue<number> {
  const [present, safeToRemove] = usePresence();
  const done: MutableRefObject<(() => void) | undefined> = useRef<(() => void) | undefined>(undefined);
  done.current = safeToRemove ?? undefined;
  const { tier }: TreeMotionState = useTreeMotion();
  const opacity: MotionValue<number> = useMotionValue<number>(1);
  useLayoutEffect((): (() => void) => {
    let live: boolean = true;
    const controls: AnimationPlaybackControls = animate(opacity, present ? 1 : 0, tier === 'full' ? LEAVE : { duration: 0 });
    if (!present) void controls.finished.then((): void => { if (live) done.current?.(); });
    return (): void => { live = false; controls.stop(); };
  }, [present, tier, opacity]);
  return opacity;
}

/** Fades its contents out when the presence it sits in leaves. */
export function FadeOnLeave({ children }: { children: ReactNode }): JSX.Element {
  return <motion.div style={{ opacity: useFadeOut() }}>{children}</motion.div>;
}

/** The props a row's line spreads onto its `motion` element. */
export interface RowLine {
  /** Absent in lite: nothing glides, so nothing is projected. */
  readonly layoutId?: string;
  readonly layout?: 'position';
  readonly initial: false | { readonly opacity: number };
  readonly animate: { readonly opacity: number; readonly transition?: Transition };
}

interface TreeMotionState {
  readonly tier: MotionTier;
  /** False for the tree's first render: what is there when it appears is simply there. */
  readonly mounted: boolean;
  /** The lines on screen as of the last commit, by layout id. */
  readonly onScreen: MutableRefObject<ReadonlySet<string>>;
}

const TreeMotionContext: Context<TreeMotionState | null> = createContext<TreeMotionState | null>(null);

function useTreeMotion(): TreeMotionState {
  const state: TreeMotionState | null = useContext(TreeMotionContext);
  if (state === null) throw new Error('A focused-tree row was rendered outside TreeMotion');
  return state;
}

/** A row's line: glides from wherever it was; if it was nowhere on screen, arrives late. */
export function useRowLine(layoutId: string): RowLine {
  const { tier, onScreen }: TreeMotionState = useTreeMotion();
  // Read once, as the line mounts; framer reads `initial` only then.
  const [moved] = useState<boolean>((): boolean => onScreen.current.has(layoutId));
  // Every line that mounts fades in, moved or not: in lite its old copy is already gone, not gliding away.
  if (tier === 'lite') return { initial: { opacity: 0 }, animate: { opacity: 1 } };
  return {
    layoutId,
    layout: 'position',
    initial: moved ? false : { opacity: 0 },
    animate: tier === 'full' ? { opacity: 1, transition: ARRIVE } : { opacity: 1 },
  };
}

/** The tier the tree is moving at, for the boxes around its rows (tree-boxes). */
export function useTreeTier(): MotionTier {
  return useTreeMotion().tier;
}

/** For a presence: false on the tree's first render, so lists present then do not animate in. */
export function usePresenceInitial(): boolean {
  return useTreeMotion().mounted;
}

/** After every commit of the tree, notes which lines are on screen, for the next selection's arrivals. */
export function useRememberOnScreen(tree: RefObject<HTMLElement>): void {
  const { onScreen }: TreeMotionState = useTreeMotion();
  useLayoutEffect((): void => {
    const live: NodeListOf<HTMLElement> | undefined = tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"][data-motion-id]');
    onScreen.current = new Set([...(live ?? [])].map((el: HTMLElement): string => el.dataset.motionId ?? ''));
  });
}

const Leaving: Context<boolean> = createContext<boolean>(false);

/** True while this row, or anything it sits inside, is animating out. */
export function useLeaving(): boolean {
  const present: boolean = useIsPresent();
  return useContext(Leaving) || !present;
}

/** Passes "leaving" down to rows nested inside a presence child. */
export function PresenceScope({ children }: { children: ReactNode }): JSX.Element {
  const leaving: boolean = useLeaving();
  return <Leaving.Provider value={leaving}>{children}</Leaving.Provider>;
}

export function TreeMotion({ children }: { children: ReactNode }): JSX.Element {
  const tier: MotionTier = useMotionTier();
  const [mounted, setMounted] = useState<boolean>(false);
  useEffect((): void => setMounted(true), []);
  const onScreen: MutableRefObject<ReadonlySet<string>> = useRef<ReadonlySet<string>>(new Set());
  return (
    <MotionConfig reducedMotion={CONFIG[tier].reducedMotion} transition={CONFIG[tier].transition}>
      <TreeMotionContext.Provider value={{ tier, mounted, onScreen }}>
        <LayoutGroup id="focused-tree">{children}</LayoutGroup>
      </TreeMotionContext.Provider>
    </MotionConfig>
  );
}

export { AnimatePresence };
