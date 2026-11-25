import { strict as assert } from 'node:assert';

/**
 * A control that draws an edge must draw one that is seen: WCAG 1.4.11 asks 3:1 of a component's
 * boundary against what is next to it. axe measures text only, so it passed the Calendar's outline
 * buttons (owner, 2026-11-25): white text, clean, on a border about 1.1:1 against the page in both
 * themes. Measured here on the computed colours at rest: a control whose border is drawn passes when
 * the border or its own fill clears 3:1 against the opaque surface behind it. A control that draws no
 * edge and no fill (ghost, link) is identified by its text, which axe already measures; a disabled
 * one is exempt, as WCAG exempts it. Returns how many edges it measured, so a caller can show it
 * measured something.
 */
const MIN = 3;

export async function controlEdgesAreSeen(page, scope, what) {
  const { measured, found } = await page.locator(`${scope} :is(button, select, textarea, input:not([type="checkbox"]):not([type="radio"]))`).evaluateAll((nodes, min) => {
    const parse = (css) => {
      const m = /^rgba?\(([^)]+)\)$/.exec(css.trim());
      if (m === null) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
    };
    const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    /** The colour behind `n`: its ancestors' backgrounds composited down to the first opaque one. */
    const surface = (n) => {
      const layers = [];
      for (let at = n.parentElement; at !== null; at = at.parentElement) {
        const bg = parse(getComputedStyle(at).backgroundColor);
        if (bg === null) return null;
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] === 1) return layers.reverse().reduce((under, top) => over(top, under));
      }
      return null;
    };
    const out = [];
    let measured = 0;
    for (const n of nodes) {
      if (n.getClientRects().length === 0 || n.disabled || n.getAttribute('aria-disabled') === 'true') continue;
      const style = getComputedStyle(n);
      const border = parse(style.borderTopColor);
      const drawn = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none' && (border === null || border[3] > 0);
      if (!drawn) continue;
      measured += 1;
      const id = n.getAttribute('aria-label') ?? (n.textContent || n.tagName).trim().slice(0, 40);
      const behind = surface(n);
      const ownFill = parse(style.backgroundColor);
      if (behind === null || border === null || ownFill === null) {
        out.push({ id, unmeasured: `${style.borderTopColor} / ${style.backgroundColor}` });
        continue;
      }
      const fill = over(ownFill, behind);
      const edge = Math.max(ratio(over(border, fill), behind), ratio(fill, behind));
      if (edge < min) out.push({ id, edge: Number(edge.toFixed(2)) });
    }
    return { measured, found: out };
  }, MIN);
  const named = found.map((f) => (f.unmeasured === undefined ? `${f.id} ${f.edge}:1` : `${f.id} (unmeasured: ${f.unmeasured})`));
  assert.deepEqual(named, [], `${what}: control edges under ${MIN}:1 against their surface: ${named.slice(0, 6).join('; ')}`);
  return measured;
}
