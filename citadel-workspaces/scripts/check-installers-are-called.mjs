/**
 * A `bind…`/`start…` function nothing calls.
 *
 * These wire an application up: they subscribe to a bus, register a listener,
 * start a poll. Unlike a component they render nothing, so nothing looks wrong
 * when one is never called — and the two gates beside this one both miss it.
 * `check-modules-are-imported` sees the module imported, because its own TEST
 * imports it. `check-components-are-mounted` only knows about components.
 *
 * Round 471 nearly shipped exactly this. `bindPeerGroupDelivery` was written,
 * tested three ways, and its call in `startGroupEventBindings` was the one line
 * that made any of it run. Commenting that line out left the whole suite green,
 * because the tests called the binding themselves — a test that constructs the
 * thing it tests cannot say whether production constructs it.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is not incidental. The first version of
 * this scan reported "0 uncalled" against a tree where the call had been
 * commented out, because `// bindPeerGroupDelivery();` still matched. A check
 * satisfied by a comment is not a check, and the control caught it.
 *
 * No baseline: the tree passes outright.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Installers reached in a way a text scan cannot see. An entry must say how it
 * IS called, so the claim can be checked rather than believed.
 */
const CALLED_INDIRECTLY = new Map([
  // (empty — every installer in the tree has a findable caller)
]);

const isTest = (file) => file.includes('__tests__') || /\.test\.tsx?$/.test(file);

// A commented-out call is exactly the regression being hunted, so it must not
// count as a caller.
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const files = execFileSync('git', ['ls-files', 'src'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((file) => /\.tsx?$/.test(file) && !isTest(file));

const sources = new Map(files.map((f) => [f, stripComments(readFileSync(`${root}/${f}`, 'utf8'))]));

const INSTALLER = /export function (bind|start|setup|register|install|mount)([A-Z]\w*)/g;

const uncalled = [];
for (const [file, text] of sources) {
  for (const match of text.matchAll(INSTALLER)) {
    const name = `${match[1]}${match[2]}`;
    if (CALLED_INDIRECTLY.has(name)) continue;

    let called = false;
    for (const [other, otherText] of sources) {
      if (other === file) continue;
      if (new RegExp(`\\b${name}\\s*\\(`).test(otherText)) { called = true; break; }
    }
    if (!called) uncalled.push(`${file}::${name}`);
  }
}

if (uncalled.length > 0) {
  console.error(`  Installers called: ${uncalled.length} installer(s) nothing calls  FAIL`);
  for (const entry of uncalled) console.error(`    ${entry}`);
  console.error('');
  console.error('  This subscribes, registers or starts something, and no production code');
  console.error('  runs it -- so none of what it wires up happens. Its own tests pass either');
  console.error('  way, because they call it themselves. Call it, delete it, or add it to');
  console.error('  CALLED_INDIRECTLY saying how it IS reached.');
  process.exit(1);
}

console.log('  Installers called: every bind/start/setup function has a caller  ok');
