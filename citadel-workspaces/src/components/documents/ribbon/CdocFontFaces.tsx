/**
 * The engine's faces as CSS faces, so the font picker and the styles gallery preview text in
 * the face the page will draw it in (Calibri is served as Carlito, exactly as the engine
 * aliases it). Faces come from the generated manifest and are fetched only when a preview
 * uses one.
 */
import { CDOC_FONT_BASE_URL } from '@/lib/cdoc/asset-urls';
import type { FontFaceEntry, FontManifest } from '@/lib/cdoc/fonts/font-manifest';
import { FONT_MANIFEST } from '@/lib/cdoc/generated/font-manifest';
import { servedFamily } from './formatting';

const PREFIX: string = 'cdoc ';

/** The CSS font-family that draws `requested` as the engine would (sans-serif until it loads). */
export function cssFontFamily(requested: string, manifest: FontManifest): string {
  return `"${PREFIX}${servedFamily(requested, manifest)}", sans-serif`;
}

export function fontFaceCss(manifest: FontManifest, baseUrl: string): string {
  return manifest.faces.map((f: FontFaceEntry): string => [
    '@font-face {',
    `font-family: "${PREFIX}${f.family}";`,
    `src: url("${baseUrl}${encodeURIComponent(f.file)}") format("truetype");`,
    `font-weight: ${f.bold ? 700 : 400};`,
    `font-style: ${f.italic ? 'italic' : 'normal'};`,
    'font-display: swap;',
    '}',
  ].join(' ')).join('\n');
}

const CSS: string = fontFaceCss(FONT_MANIFEST, CDOC_FONT_BASE_URL);

export function CdocFontFaces(): JSX.Element {
  return <style data-testid="cdoc-font-faces">{CSS}</style>;
}
