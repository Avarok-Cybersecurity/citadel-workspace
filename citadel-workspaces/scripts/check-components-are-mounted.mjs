/**
 * A component nobody renders, kept alive by its own test.
 *
 * `PeerRefusalNotice` and `PersistFailureNotice` render nothing and exist only
 * to be mounted: each subscribes to an event and raises a notice. Delete the
 * one line in App.tsx that mounts one and everything still passes — the
 * component's tests render it directly and go green, and
 * `check-modules-are-imported` sees it imported, because the TEST file imports
 * it. Removing `PeerRefusalNotice` from App.tsx entirely left that gate
 * reporting "1266 file(s), all imported ok".
 *
 * That is the exact shape this campaign keeps finding: a feature built from one
 * end, where the half that is missing is the half nothing asserts. A notice
 * that is never mounted is a control that operates on nothing, and it looks
 * like working, tested code.
 *
 * So: every exported component must be RENDERED somewhere in production code —
 * as `<Name`, as `component={Name}`, or as `element={<Name`. Rendering inside
 * its own module counts: a helper used by the exported parent beside it is
 * mounted through that parent.
 *
 * Test files count on neither side. A component rendered only by its own test
 * is precisely the defect.
 *
 * There is no baseline. The tree passes this outright, and a gate that starts
 * at zero should stay at zero.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Components reached in a way no textual scan can see. An entry must say how
 * the component is actually mounted, so the claim can be checked.
 */
const RENDERED_INDIRECTLY = new Map([
  // A first-party glue app's tab: src/lib/citadel-apps/first-party/registry.ts GLUE_TABS loads it
  // by import() under its app id, and AppTabPane.tsx's GlueTabHost renders it as `<loaded.Tab`.
  ['CalendarMount', 'first-party/registry.ts GLUE_TABS, rendered by AppTabPane.tsx as <loaded.Tab'],
  // Loaded by import() after first paint so neither is on a critical path, and rendered from state.
  ['PageCalendarBackground', 'calendar/background/CalendarInBackground.tsx imports it, rendered as <Background /> in AppLayout'],
  ['CalendarNotificationsHere', 'settings/NotificationsSettingsTab.tsx loadCalendar imports it, rendered as <Calendar />'],
]);

const isTest = (file) => file.includes('__tests__') || /\.test\.tsx?$/.test(file);

const production = execFileSync('git', ['ls-files', 'src'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((file) => /\.tsx?$/.test(file) && !isTest(file));

const sources = new Map(production.map((file) => [file, readFileSync(`${root}/${file}`, 'utf8')]));

// `export function Name`, `export default function Name`, and the arrow forms
// `export const Name = (` / `export const Name: Type = (`.
const DECLARATIONS = [
  /export (?:default )?function ([A-Z]\w*)/g,
  /export const ([A-Z]\w*)(?::[^=]+)? = (?:\(|React\.memo|memo|forwardRef)/g,
];

const unmounted = [];
for (const [file, text] of sources) {
  if (!file.endsWith('.tsx')) continue;
  const declared = new Set();
  for (const pattern of DECLARATIONS) {
    for (const match of text.matchAll(pattern)) declared.add(match[1]);
  }

  for (const name of declared) {
    if (RENDERED_INDIRECTLY.has(name)) continue;
    let rendered = false;
    for (const other of sources.values()) {
      if (other.includes(`<${name}`) || other.includes(`component={${name}}`) || other.includes(`element={<${name}`)) {
        rendered = true;
        break;
      }
    }
    if (!rendered) unmounted.push(`${file}::${name}`);
  }
}

if (unmounted.length > 0) {
  console.error(`  Components mounted: ${unmounted.length} exported component(s) nothing renders  FAIL`);
  for (const entry of unmounted) console.error(`    ${entry}`);
  console.error('');
  console.error('  Nothing in production renders this. If it is a notice or a listener, it does');
  console.error('  nothing at all -- its tests render it directly and pass either way. Mount it,');
  console.error('  delete it, or add it to RENDERED_INDIRECTLY saying how it IS reached.');
  process.exit(1);
}

console.log(`  Components mounted: every exported component is rendered somewhere  ok`);
