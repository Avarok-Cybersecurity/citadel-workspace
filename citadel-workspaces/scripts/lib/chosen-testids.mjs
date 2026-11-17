/**
 * Testids an element CHOOSES by an expression: `OfflineBanner.tsx` renders one of five with a
 * ternary, `data-testid={reconnecting ? 'server-reconnecting-banner' : …}`. Each quoted literal
 * in the braces is an id the element renders in one of its states; such a choice nests no
 * braces. Shared by the gates that ask whether a testid exists, so they agree on what does.
 */
export function chosenTestIds(source) {
  const ids = [];
  for (const m of source.matchAll(/data-testid=\{([^{}`]*)\}/g)) {
    for (const lit of m[1].matchAll(/["']([A-Za-z0-9_-]+)["']/g)) ids.push(lit[1]);
  }
  return ids;
}

/**
 * Testids set on an element the host builds without React (`zone-surface.ts`, `zone-toolbar.ts`
 * build plain DOM around an app's canvas): `el.dataset.testid = 'app-zone-toolbar'` renders
 * `data-testid="app-zone-toolbar"` exactly as the attribute would.
 */
export function domSetTestIds(source) {
  return [...source.matchAll(/\.dataset\.testid\s*=\s*["']([A-Za-z0-9_-]+)["']/g)].map((m) => m[1]);
}
