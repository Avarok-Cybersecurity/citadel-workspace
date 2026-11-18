import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Where keyboard focus restarts when the page inside the shell changes.
 *
 * One shell spans every signed-in page (WorkspaceShell), so a page change only
 * swaps what is inside <main>. When focus was in the outgoing page -- the
 * directory focuses its search box on mount -- that element is removed and
 * focus falls to <body>, but Chromium keeps its sequential-navigation starting
 * point where the removed element was. The next Tab then lands on the first
 * control of the NEW page's content, past the skip link, the top bar and the
 * sidebar: the skip link is unreachable after every such navigation. CI run
 * 44190289145 measured it, 3 of 3 attempts.
 *
 * So, in the same commit that removed the page, focus restarts here: the first
 * element of the shell, before the skip link, focusable only by script
 * (tabIndex -1) and invisible. The next Tab reaches the skip link, exactly as on
 * a fresh load. Focus that is still somewhere -- a sidebar control the user
 * pressed, which outlives the change -- is left where it is.
 */
export function PageChangeFocusTarget(): JSX.Element {
  const { pathname } = useLocation();
  const target: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const shownPath: React.MutableRefObject<string> = useRef<string>(pathname);

  // Layout, not passive: it runs in the commit that removed the outgoing page,
  // so no keypress can arrive between focus being lost and being restored.
  useLayoutEffect((): void => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    const active: Element | null = document.activeElement;
    if (active !== null && active !== document.body) return;
    target.current?.focus({ preventScroll: true });
  }, [pathname]);

  return <div ref={target} tabIndex={-1} className="sr-only" />;
}
