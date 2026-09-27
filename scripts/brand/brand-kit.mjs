/**
 * The brand kit (assets/brand) turned into what the UI ships. Pure: every function takes the
 * kit's bytes or text and returns bytes or text, so the sync and the check share one derivation
 * and the tests need no filesystem. The I/O lives in scripts/sync-brand-kit.mjs.
 *
 * Nothing here draws or recolours the mark. The artwork modules carry the kit's own outlined
 * paths; only the two colour roles (ink, arrow) are left to the page, because the page picks the
 * light or -ondark cut from its ground. The pairing below refuses a kit whose plain and -ondark
 * files differ in anything BUT those two colours, so that freedom cannot become a redraw.
 */

/** Kit file -> citadel-workspaces/public path, per assets/brand/README.md. Copied byte for byte. */
export const PUBLIC_COPIES = Object.freeze([
  ['favicon.ico', 'favicon.ico'],
  ['svg/mask-icon.svg', 'mask-icon.svg'],
  ['dark/apple-touch-icon-180.png', 'icons/apple-touch-icon-180.png'],
  ['dark/icon-192.png', 'icons/icon-192.png'],
  ['dark/icon-512.png', 'icons/icon-512.png'],
  ['dark/icon-maskable-512.png', 'icons/icon-maskable-512.png'],
  ['dark/og-image-1200x630.png', 'og-image-1200x630.png'],
]);

/** The lockups the app draws, by the module name the UI imports. */
export const ARTWORKS = Object.freeze([
  ['mark', 'svg/mark.svg', 'svg/mark-ondark.svg'],
  ['mark-compact', 'svg/mark-compact.svg', 'svg/mark-compact-ondark.svg'],
  ['logo-horizontal', 'svg/logo-horizontal.svg', 'svg/logo-horizontal-ondark.svg'],
  ['logo-stacked', 'svg/logo-stacked.svg', 'svg/logo-stacked-ondark.svg'],
  ['wordmark', 'svg/wordmark.svg', 'svg/wordmark-ondark.svg'],
]);

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};

/** One kit SVG: its box and its three kinds of path (the C's arc, the arrow, the outlined name). */
export function parseArtwork(svg, file) {
  const root = svg.match(/<svg\b[^>]*>/)?.[0];
  if (!root) throw new Error(`${file}: no <svg> element`);
  const viewBox = attr(root, 'viewBox');
  if (!viewBox) throw new Error(`${file}: no viewBox`);
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  const strokes = [];
  const fills = [];
  for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
    const d = attr(tag, 'd');
    const stroke = attr(tag, 'stroke');
    const fill = attr(tag, 'fill');
    if (!d) throw new Error(`${file}: a path with no d`);
    if (stroke && fill === 'none') {
      strokes.push({ d, colour: stroke.toUpperCase(), width: Number(attr(tag, 'stroke-width')) });
    } else if (fill && fill !== 'none' && !stroke) {
      fills.push({ d, colour: fill.toUpperCase() });
    } else {
      throw new Error(`${file}: a path that is neither a stroke nor a fill`);
    }
  }
  if (strokes.length !== 2) throw new Error(`${file}: expected the arc and the arrow, found ${strokes.length} strokes`);
  if (fills.length > 1) throw new Error(`${file}: expected at most one outlined name, found ${fills.length}`);
  const [arc, arrow] = strokes;
  if (arc.width !== arrow.width) throw new Error(`${file}: the arc and the arrow have different strokes`);
  const radius = Number(arc.d.match(/A\s*([\d.]+)/)?.[1]);
  if (!Number.isFinite(radius)) throw new Error(`${file}: the first stroke is not the C's arc`);
  return {
    viewBox, width, height, radius, strokeWidth: arc.width,
    arc: arc.d, arrow: arrow.d, glyphs: fills[0]?.d ?? null,
    colours: { arc: arc.colour, arrow: arrow.colour, glyphs: fills[0]?.colour ?? null },
  };
}

/**
 * The plain and -ondark cuts as one artwork. They must be the same drawing, coloured with the
 * kit's light-ground and dark-ground values respectively (brand.json), or this throws.
 */
export function pairArtwork(plainSvg, ondarkSvg, brand, file) {
  const light = parseArtwork(plainSvg, `${file} (plain)`);
  const dark = parseArtwork(ondarkSvg, `${file} (ondark)`);
  for (const key of ['viewBox', 'strokeWidth', 'arc', 'arrow', 'glyphs']) {
    if (light[key] !== dark[key]) throw new Error(`${file}: the plain and -ondark cuts differ in ${key}`);
  }
  const want = (ground) => ({
    arc: brand.color.ink[ground], arrow: brand.color.arrow[ground], glyphs: light.glyphs ? brand.color.ink[ground] : null,
  });
  for (const [cut, ground] of [[light, 'onLight'], [dark, 'onDark']]) {
    const expected = want(ground);
    for (const role of ['arc', 'arrow', 'glyphs']) {
      const e = expected[role]?.toUpperCase() ?? null;
      if (cut.colours[role] !== e) throw new Error(`${file}: ${role} is ${cut.colours[role]} ${ground}, brand.json says ${e}`);
    }
  }
  return light;
}

/**
 * Clear space in the artwork's own units: one x, the arrowhead's height, 46 in the mark's
 * 200-unit grid, scaled by how large the lockup draws the C. The compact cut is drawn in that
 * grid already (its radius is brand.json's compact.r), so its scale is 1.
 */
export function clearSpaceUnits(artwork, brand) {
  const g = brand.geometry;
  const compact = artwork.radius === g.compact.r && artwork.strokeWidth === g.compact.stroke;
  return Number((g.clearSpace * (compact ? 1 : artwork.radius / g.circle.r)).toFixed(2));
}

const GENERATED = (source) =>
  `// GENERATED by scripts/sync-brand-kit.mjs in the parent repository from assets/brand/${source}.\n` +
  '// Do not edit: change the kit and re-run the sync. scripts/check-brand-kit-is-synced.mjs fails on drift.\n';

const camel = (name) => name.toUpperCase().replace(/-/g, '_');

export function renderArtworkModule(name, artwork, brand, source) {
  const glyphs = artwork.glyphs === null ? 'null' : JSON.stringify(artwork.glyphs);
  return `${GENERATED(source)}import type { BrandArtwork } from './brand-artwork';

export const ${camel(name)}: BrandArtwork = {
  viewBox: ${JSON.stringify(artwork.viewBox)},
  width: ${artwork.width},
  height: ${artwork.height},
  strokeWidth: ${artwork.strokeWidth},
  clearSpace: ${clearSpaceUnits(artwork, brand)},
  arc: ${JSON.stringify(artwork.arc)},
  arrow: ${JSON.stringify(artwork.arrow)},
  glyphs: ${glyphs},
};
`;
}

/** The kit's minimum sizes and its name, for the UI's sizing rules and copy. */
export function renderRulesModule(brand, manifest) {
  const m = brand.minimumSize;
  return `${GENERATED('tokens/brand.json and site.webmanifest')}
export const BRAND_NAME: ${JSON.stringify(manifest.name)} = ${JSON.stringify(manifest.name)};
export const BRAND_SHORT_NAME: ${JSON.stringify(manifest.short_name)} = ${JSON.stringify(manifest.short_name)};

/** CSS pixels. Lockups are measured across, the mark by its height. */
export const MINIMUM_SIZE: {
  readonly markPx: number;
  readonly compactBelowPx: number;
  readonly horizontalPx: number;
  readonly wordmarkPx: number;
  readonly stackedPx: number;
} = {
  markPx: ${m.markPx},
  compactBelowPx: ${m.compactBelowPx},
  horizontalPx: ${m.horizontalPx},
  wordmarkPx: ${m.wordmarkPx},
  stackedPx: ${m.stackedPx},
};

/** The logo's two colour roles on each ground. styles/brand-tokens.css must carry these. */
export const BRAND_COLOURS: {
  readonly light: { readonly ink: string; readonly arrow: string };
  readonly dark: { readonly ink: string; readonly arrow: string };
} = {
  light: { ink: ${JSON.stringify(brand.color.ink.onLight)}, arrow: ${JSON.stringify(brand.color.arrow.onLight)} },
  dark: { ink: ${JSON.stringify(brand.color.ink.onDark)}, arrow: ${JSON.stringify(brand.color.arrow.onDark)} },
};
`;
}

/** site.webmanifest as the object vite-plugin-pwa is given, so the app ships one manifest. */
export function renderManifestModule(manifest) {
  const body = JSON.stringify(manifest, null, 2).replace(/"([a-z_]+)":/g, '$1:');
  return `${GENERATED('site.webmanifest')}import type { ManifestOptions } from 'vite-plugin-pwa';

export const KIT_MANIFEST: Readonly<Partial<ManifestOptions>> = ${body};
`;
}

/**
 * favicon.svg for the tab strip. The kit ships the compact cut twice, favicon.svg (light ground)
 * and favicon-ondark.svg; a browser tab strip is dark in dark mode, where the light-ground file is
 * forbidden. This is those two files as one: the kit's paths, each ground's own colours, chosen by
 * prefers-color-scheme. The kit's provenance manifest is not carried, because this is a new file.
 */
export function renderAdaptiveFavicon(lightSvg, darkSvg, brand) {
  const art = pairArtwork(lightSvg, darkSvg, brand, 'favicon.svg');
  const [ink, arrow, inkDark, arrowDark] = [
    brand.color.ink.onLight, brand.color.arrow.onLight, brand.color.ink.onDark, brand.color.arrow.onDark,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${art.viewBox}" role="img" aria-label="Citadel Workspaces">
  <title>Citadel Workspaces</title>
  <!-- GENERATED by scripts/sync-brand-kit.mjs from assets/brand/favicon.svg and favicon-ondark.svg. Do not edit. -->
  <style>
    .ink { stroke: ${ink}; }
    .arrow { stroke: ${arrow}; }
    @media (prefers-color-scheme: dark) {
      .ink { stroke: ${inkDark}; }
      .arrow { stroke: ${arrowDark}; }
    }
  </style>
  <g fill="none" stroke-width="${art.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
    <path class="ink" d="${art.arc}"/>
    <path class="arrow" d="${art.arrow}"/>
  </g>
</svg>
`;
}

/**
 * Every file the UI receives from the kit, as [ui-relative path, contents]. `read(kitPath)` returns
 * a Buffer; text files are decoded here.
 */
export function uiFiles(read) {
  const text = (p) => read(p).toString('utf8');
  const brand = JSON.parse(text('tokens/brand.json'));
  const manifest = JSON.parse(text('site.webmanifest'));
  const out = PUBLIC_COPIES.map(([from, to]) => [`public/${to}`, read(from)]);
  out.push(['public/favicon.svg', renderAdaptiveFavicon(text('favicon.svg'), text('favicon-ondark.svg'), brand)]);
  for (const [name, plain, ondark] of ARTWORKS) {
    const art = pairArtwork(text(plain), text(ondark), brand, plain);
    out.push([`src/components/brand/artwork/${name}.generated.ts`, renderArtworkModule(name, art, brand, plain)]);
  }
  out.push(['src/components/brand/artwork/brand-rules.generated.ts', renderRulesModule(brand, manifest)]);
  out.push(['src/pwa/kit-manifest.generated.ts', renderManifestModule(manifest)]);
  return out;
}
