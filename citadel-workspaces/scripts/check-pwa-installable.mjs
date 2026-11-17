/**
 * Fails the build if the app would stop being installable.
 *
 * The install button in the URL bar is not something the app draws — the browser
 * offers it only when a set of conditions is met, and if one quietly breaks the
 * button simply never appears again. Nothing errors, nothing logs, and the only
 * symptom is an affordance that used to be there.
 *
 * The manifest is checked against the built artefact rather than a served URL on
 * purpose: in dev, `/manifest.webmanifest` returns 200 with the SPA fallback
 * HTML, so a fetch-based check would pass while validating a web page.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

// --- Service worker ---------------------------------------------------------
check(existsSync(join(dist, 'sw.js')), 'dist/sw.js is missing — the app cannot work offline or update.');

// The navigation fallback must be a URL the host serves without a redirect, and it must be
// precached. The Worker answers /index.html with a 307 to `/`; when the cached shell was
// missing, the worker's network fallback handed that redirect to a navigation, which the
// browser refuses, so every page of the site failed until its data was cleared.
if (existsSync(join(dist, 'sw.js'))) {
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  const bound = sw.match(/createHandlerBoundToURL\("([^"]+)"\)/)?.[1];
  check(bound === '/', `the service worker's navigation fallback is ${bound ?? 'absent'}, not "/" — the host redirects /index.html, and a redirected navigation fails.`);
  check(/\{url:"\/",revision:/.test(sw), 'the service worker does not precache "/" — its navigation fallback would always go to the network.');
}

// --- Manifest ---------------------------------------------------------------
const manifestPath = join(dist, 'manifest.webmanifest');
if (!existsSync(manifestPath)) {
  console.error('dist/manifest.webmanifest is missing — the browser cannot offer to install the app.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// The fields Chrome actually requires before it will show the install prompt.
check(!!manifest.name, 'manifest.name is missing.');
check(!!manifest.short_name, 'manifest.short_name is missing — used under the home-screen icon.');
check(!!manifest.start_url, 'manifest.start_url is missing.');
check(
  ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display),
  `manifest.display is "${manifest.display}" — "browser" is not installable.`
);

// --- Icons ------------------------------------------------------------------
const icons = manifest.icons ?? [];
const hasSize = (size) => icons.some((i) => (i.sizes ?? '').split(' ').includes(`${size}x${size}`));
check(hasSize(192), 'No 192x192 icon — Chrome requires one to offer installation.');
check(hasSize(512), 'No 512x512 icon — Chrome requires one to offer installation.');
check(
  icons.some((i) => (i.purpose ?? '').split(' ').includes('maskable')),
  'No maskable icon — Android will letterbox the icon inside a white circle instead of filling the shape.'
);

/**
 * A PNG's real dimensions, read from the IHDR chunk: the 8-byte signature is
 * followed by a length and the type "IHDR", then width and height as big-endian
 * u32s at offsets 16 and 20.
 */
function pngSize(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 24 || bytes.subarray(1, 4).toString() !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// Declared icons must actually exist, or the browser silently drops them and the
// size checks above become meaningless.
//
// And the declared size must be the file's REAL size. `sizes` is a claim the
// manifest makes about an image nobody opened; a 512 entry pointing at a 128px
// file leaves every check above passing while the browser, which measures the
// image itself, quietly stops offering to install. That is the same class of
// silent failure this whole script exists to catch.
for (const icon of icons) {
  const file = join(dist, icon.src.replace(/^\//, ''));
  if (!existsSync(file)) {
    check(false, `manifest lists ${icon.src} but the file is not in the build.`);
    continue;
  }
  if (!icon.src.endsWith('.png')) continue;

  const actual = pngSize(file);
  if (!actual) {
    check(false, `${icon.src} is listed as an icon but is not a readable PNG.`);
    continue;
  }
  for (const declared of (icon.sizes ?? '').split(' ').filter(Boolean)) {
    const [w, h] = declared.split('x').map(Number);
    check(
      actual.width === w && actual.height === h,
      `${icon.src} declares ${declared} but the file is ${actual.width}x${actual.height}.`
    );
  }
}

// --- Install-card screenshots ------------------------------------------------
//
// Chrome shows its richer install dialog — imagery and description rather than
// a bare confirm — only when the manifest carries screenshots, and only uses a
// wide one on desktop when a `wide` form_factor is declared.
//
// The failure mode is silent in exactly the way the icon check above guards
// against: a `sizes` that does not match the file is DROPPED by the browser
// without complaint, so the manifest still validates, the images still ship,
// and the install prompt quietly degrades to the plain one. Nothing else in the
// build would notice.
const screenshots = manifest.screenshots ?? [];
check(screenshots.length > 0, 'No manifest screenshots — the install prompt falls back to its plain form.');
check(
  screenshots.some((s) => s.form_factor === 'wide'),
  'No screenshot declares form_factor "wide" — desktop Chrome will not show the rich install dialog.'
);

for (const shot of screenshots) {
  const file = join(dist, (shot.src ?? '').replace(/^\//, ''));
  if (!shot.src || !existsSync(file)) {
    check(false, `manifest lists screenshot ${shot.src} but the file is not in the build.`);
    continue;
  }
  if (!shot.src.endsWith('.png')) continue;

  const actual = pngSize(file);
  if (!actual) {
    check(false, `${shot.src} is listed as a screenshot but is not a readable PNG.`);
    continue;
  }
  const [w, h] = (shot.sizes ?? '').split('x').map(Number);
  check(
    actual.width === w && actual.height === h,
    `${shot.src} declares ${shot.sizes} but the file is ${actual.width}x${actual.height} — the browser drops it silently.`
  );
}

// Safari ignores the manifest for home-screen icons and uses this link instead,
// so an app can be perfectly installable on Android and still land on an iPhone
// home screen as a blurry screenshot of the page.
// iOS ignores manifest icons entirely for "Add to Home Screen" and reads this
// <link> instead, so both halves have to hold: the tag must be DECLARED, and the
// file it names must be in the build.
//
// The path is derived from index.html rather than hardcoded here. Hardcoding it
// proved only the second half: delete the <link> and the file still sits in
// dist/, every check passes, and iOS quietly screenshots the login page and uses
// that as the home-screen icon. It also silently tested the wrong file the moment
// anyone changed the href, since the two copies of the path could drift apart.
const indexHtml = join(dist, 'index.html');
const html = existsSync(indexHtml) ? readFileSync(indexHtml, 'utf8') : '';
const appleHref = html
  .match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*>/i)?.[0]
  ?.match(/href=["']([^"']+)["']/i)?.[1];

if (!appleHref) {
  check(false, 'index.html declares no apple-touch-icon — iOS falls back to a screenshot of the page.');
} else {
  const appleIcon = join(dist, appleHref.replace(/^\//, ''));
  if (existsSync(appleIcon)) {
    const actual = pngSize(appleIcon);
    check(
      actual !== null && actual.width === 180 && actual.height === 180,
      `${appleHref} should be 180x180, the size iOS asks for; it is ` +
        `${actual ? `${actual.width}x${actual.height}` : 'unreadable'}.`
    );
  } else {
    check(false, `index.html declares apple-touch-icon ${appleHref} but the file is not in the build.`);
  }
}

// Shortcuts are the installed icon's context menu. They are easy to get wrong in
// a way nobody notices from a browser tab: a shortcut pointing at a route that
// no longer exists drops the user on the 404 page from their own dock, and the
// only way to see it is to install the app and right-click it.
const shortcuts = manifest.shortcuts ?? [];
for (const shortcut of shortcuts) {
  check(!!shortcut.name, 'a manifest shortcut has no name.');
  check(
    typeof shortcut.url === 'string' && shortcut.url.startsWith('/'),
    `shortcut "${shortcut.name}" has a url that is not app-relative: ${shortcut.url}`,
  );
  for (const icon of shortcut.icons ?? []) {
    check(
      existsSync(join(dist, icon.src.replace(/^\//, ''))),
      `shortcut "${shortcut.name}" lists ${icon.src} but the file is not in the build.`,
    );
  }
}

if (failures.length) {
  console.error('The app would not be installable:\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `Installable: ${manifest.name} (${icons.length} icons, ${shortcuts.length} shortcuts, ` +
    `display: ${manifest.display}), service worker present.`,
);
