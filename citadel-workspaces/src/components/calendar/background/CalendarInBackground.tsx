/**
 * Where the signed-in layout starts the Calendar's background work (CalendarBackground.tsx): loaded
 * by dynamic import after first paint, so none of it, nor the Calendar's core, is on any page's
 * critical path. A chunk that does not load is said, and the layout goes on without it.
 */
import { useEffect, useState, type ComponentType } from 'react';

export function CalendarInBackground(): JSX.Element | null {
  const [Background, setBackground] = useState<ComponentType | null>(null);
  useEffect(() => {
    let live: boolean = true;
    import('./CalendarBackground').then((m: typeof import('./CalendarBackground')): void => {
      if (live) setBackground(() => m.default);
    }, (error: unknown): void => console.error('[calendar] the background work could not load; reminders will not fire in this window', error));
    return (): void => { live = false; };
  }, []);
  return Background === null ? null : <Background />;
}
