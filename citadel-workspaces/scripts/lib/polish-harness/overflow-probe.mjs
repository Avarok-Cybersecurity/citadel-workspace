/**
 * Two measurements of overflow, run in the page (pass them to `page.evaluate`).
 *
 * `clippedUnder(selector)`: every element under the root that clips content it cannot show. An
 * element clips when an axis's computed overflow is `hidden` or `clip` and its content is larger
 * than its box on that axis (scrollHeight vs clientHeight, scrollWidth vs clientWidth). That is
 * content nobody can scroll to. Left out, because each of them shows that it is cut or owns its
 * own scroll: a form control, a run of text ending in an ellipsis or clamped to lines (the
 * ellipsis says so; truncation has its own gates), a visually hidden element (sr-only), and the
 * document's own root (html, body, #root), which index.css keeps from scrolling sideways on purpose.
 * An axis whose size the element's inline style sets is left out too: that size is data, not
 * room for content (a time grid's event is as tall as it lasts, its words in its label and its
 * details; a disclosure animates its height), and cutting what does not fit it is the design.
 *
 * `reachByScrolling(selector)`: whether the element can be brought into view the way a person
 * would: by scrolling only the containers a person can scroll (overflow `auto` or `scroll`, and
 * the page). A script can scroll an `overflow: hidden` box and a finger cannot, so this never
 * does. After scrolling, the element must lie inside every clipping ancestor and the viewport,
 * and a point at its centre must reach it. Returns null, or what stops it.
 */
export function clippedUnder(selector) {
  const root = document.querySelector(selector);
  if (root === null) return [`nothing matches ${selector}`];
  const name = (el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : ''}.${[...el.classList].join('.')}`.slice(0, 160);
  const clipping = (o) => o === 'hidden' || o === 'clip';
  const found = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el.getClientRects().length === 0 || el.matches('html, body, #root, input, textarea, select, .sr-only')) continue;
    const s = getComputedStyle(el);
    if (s.textOverflow === 'ellipsis' || (s.webkitLineClamp !== undefined && s.webkitLineClamp !== 'none')) continue;
    const dy = el.scrollHeight - el.clientHeight;
    const dx = el.scrollWidth - el.clientWidth;
    if (clipping(s.overflowY) && dy > 1 && el.style.height === '') found.push(`${name(el)} hides ${dy}px below (overflow-y: ${s.overflowY})`);
    if (clipping(s.overflowX) && dx > 1 && el.style.width === '') found.push(`${name(el)} hides ${dx}px to the side (overflow-x: ${s.overflowX})`);
  }
  return found;
}

export function reachByScrolling(selector) {
  const el = document.querySelector(selector);
  if (el === null) return `nothing matches ${selector}`;
  const name = (a) => `${a.tagName.toLowerCase()}${a.dataset.testid ? `[data-testid=${a.dataset.testid}]` : ''}.${[...a.classList].join('.')}`.slice(0, 160);
  const scrolls = (o) => o === 'auto' || o === 'scroll';
  const ancestors = [];
  for (let a = el.parentElement; a !== null && a !== document.body && a !== document.documentElement; a = a.parentElement) ancestors.push(a);
  for (const a of ancestors) {
    const s = getComputedStyle(a);
    const r = el.getBoundingClientRect();
    const f = a.getBoundingClientRect();
    if (scrolls(s.overflowY)) a.scrollTop += Math.max(0, r.bottom - (f.top + a.clientTop + a.clientHeight));
    if (scrolls(s.overflowX)) a.scrollLeft += Math.max(0, r.right - (f.left + a.clientLeft + a.clientWidth));
  }
  const r0 = el.getBoundingClientRect();
  window.scrollBy(Math.max(0, r0.right - window.innerWidth), Math.max(0, r0.bottom - window.innerHeight));
  const r = el.getBoundingClientRect();
  const at = `${Math.round(r.top)}..${Math.round(r.bottom)} x ${Math.round(r.left)}..${Math.round(r.right)}`;
  for (const a of ancestors) {
    const s = getComputedStyle(a);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const f = a.getBoundingClientRect();
    const top = f.top + a.clientTop;
    const left = f.left + a.clientLeft;
    if (r.bottom > top + a.clientHeight + 0.5 || r.top < top - 0.5 || r.right > left + a.clientWidth + 0.5 || r.left < left - 0.5) {
      return `at ${at} it stays outside ${name(a)} (${Math.round(top)}..${Math.round(top + a.clientHeight)} x ${Math.round(left)}..${Math.round(left + a.clientWidth)}, overflow ${s.overflowX}/${s.overflowY})`;
    }
  }
  if (r.bottom > window.innerHeight + 0.5 || r.right > window.innerWidth + 0.5) return `at ${at} it stays outside the ${window.innerWidth}x${window.innerHeight} viewport`;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return el.contains(hit) ? null : `at ${at} a point at its centre reaches ${hit === null ? 'nothing' : name(hit)}`;
}
