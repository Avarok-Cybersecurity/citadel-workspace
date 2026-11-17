/**
 * Samples a sidebar transition every animation frame, in the page: every tree row (`[data-tree-node]`) and the
 * boxes around them, each as drawn (transforms included), clipped by every clipping ancestor, with its opacity.
 * motion-probe scores what this returns.
 */
/** Clicks `clicked` inside the page and returns, per track, one sample per animation frame for `ms`. */
export function sampleTransition(page, clicked, ms) {
  return page.evaluate(async ({ id, span }) => {
    const tree = () => document.querySelector('[role="tree"]');
    // Drawn boxes are what a person sees move; the others are layout boxes with nothing painted, recorded only.
    const BOXES = {
      // The stack's tint and outline are their own layer; the list item around it paints nothing.
      stack: [true, () => document.querySelector('[data-testid="tree-ancestor-stack"] > [aria-hidden="true"]')],
      // The tree's visible extent is the clipping box its height animates on (AutoHeight); without motion, the tree.
      tree: [true, () => tree()?.parentElement.closest('.overflow-hidden') ?? tree()],
      below: [true, () => document.querySelector('[data-testid="below-tree"]')],
      siblings: [false, () => document.querySelector('[role="tree"] > li:last-child')],
      treeLayout: [false, tree],
    };
    // A clip-path inset() cuts the top and bottom edges; its lengths are px, % of the box, or calc() of both.
    const length = (arg, height) => {
      const terms = arg.replace(/^calc\((.*)\)$/, '$1').replace(/\s+-\s+/g, ' + -').split(/\s+\+\s+/);
      return terms.reduce((sum, t) => sum + (t.endsWith('%') ? (parseFloat(t) / 100) * height : parseFloat(t) || 0), 0);
    };
    const insetEdges = (clip, height) => {
      const m = /^inset\((.*)\)$/.exec(clip ?? '');
      if (!m) return null;
      const args = m[1].match(/calc\([^)]*\)|[^\s]+/g);
      const [top, , bottom = top] = args;
      return { top: length(top, height), bottom: length(bottom, height) };
    };
    const ghosts = new WeakMap();
    let next = 0;
    const uids = new WeakMap();
    const identity = (el) => { if (!uids.has(el)) uids.set(el, next++); return uids.get(el); };
    const drawn = (el) => {
      const r = el.getBoundingClientRect();
      let top = r.top;
      let bottom = r.bottom;
      let opacity = 1;
      for (let p = el; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        opacity *= Number(style.opacity);
        const c = p.getBoundingClientRect();
        if (p !== el && style.overflowY !== 'visible') {
          top = Math.max(top, c.top);
          bottom = Math.min(bottom, c.bottom);
        }
        const inset = insetEdges(style.clipPath, c.height);
        if (inset) {
          top = Math.max(top, c.top + inset.top);
          bottom = Math.min(bottom, c.bottom - inset.bottom);
        }
      }
      // What the row paints: its whole line when it has a fill (selected, hovered), else its text and icons.
      const filled = !/rgba\(.*, 0\)$|transparent/.test(getComputedStyle(el).backgroundColor);
      const marks = filled ? [r] : [...el.querySelectorAll('svg, span')].filter((m) => m.children.length === 0 || m.tagName === 'svg').map((m) => m.getBoundingClientRect()).filter((m) => m.height > 0);
      const inkTop = Math.max(top, Math.min(...marks.map((m) => m.top)));
      const inkBottom = Math.min(bottom, Math.max(...marks.map((m) => m.bottom)));
      return { top: r.top, height: r.height, shown: Math.max(0, bottom - top), shownTop: top, opacity, inkTop, ink: Math.max(0, inkBottom - inkTop) };
    };
    const frame = () => {
      const out = {};
      for (const el of document.querySelectorAll('[role="tree"] [data-tree-node]')) {
        const live = el.getAttribute('role') === 'treeitem';
        if (!live && !ghosts.has(el)) ghosts.set(el, `ghost${next++}:${el.getAttribute('data-tree-node')}`);
        out[live ? `row:${el.getAttribute('data-tree-node')}` : ghosts.get(el)] = { ...drawn(el), row: true, scored: true, el: identity(el) };
      }
      for (const [name, [scored, find]] of Object.entries(BOXES)) {
        const el = find();
        if (el) out[`box:${name}`] = { ...drawn(el), row: false, scored, el: identity(el) };
      }
      return out;
    };
    const stamped = (t) => ({ ...frame(), t });
    // Read each frame after every rAF callback in it has run (framer's among them, in whatever order the engine
    // calls them), so a sample is what that frame painted. It is stamped with the time framer computed that frame's
    // motion for (its frameData, which the scenario exposes): framer clocks a frame by performance.now() when its
    // batch runs, not by the rAF timestamp, and on a starved CPU the two drift apart by up to a frame -- measured at
    // 4x throttle, regular 8.3ms rAF stamps against steps of 14, 29, 14px, which framer's own clock spaces evenly.
    const clock = (t) => window.__motionFrame?.timestamp ?? t;
    const afterFrame = (read) => requestAnimationFrame((t) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => read(clock(t));
      channel.port2.postMessage(null);
    });
    // Script-driven motion is invisible to document.getAnimations(): wait until nothing has moved for 10 frames.
    await new Promise((done) => {
      let [last, still] = ['', 0];
      const tick = () => {
        const now = JSON.stringify(frame());
        [still, last] = [now === last ? still + 1 : 0, now];
        if (still >= 10) done(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const frames = [stamped(performance.now())];
    document.querySelector(`[data-testid="${id}"]`).click();
    const start = performance.now();
    await new Promise((done) => {
      const read = (t) => {
        frames.push(stamped(t));
        if (performance.now() - start < span) afterFrame(read); else done();
      };
      afterFrame(read);
    });
    return frames;
  }, { id: clicked, span: ms });
}
