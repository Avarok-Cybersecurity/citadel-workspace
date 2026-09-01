#!/usr/bin/env node
/**
 * In an ESM package, a relative import that runs must name a file Node can find.
 *
 * `citadel-workspace-client-ts` is `"type": "module"` and emitted
 * `import { … } from './workspace-json'`. TypeScript resolves that. Vite
 * resolves that. Node does not:
 *
 *     Cannot find module '.../dist/workspace-json'
 *       imported from '.../dist/WorkspaceClient.js'
 *
 * So the package built, typechecked, linted, and shipped output that could not
 * be imported by the runtime it declares. The browser bundle worked, which is
 * why nothing complained, and the only witness was a test suite nothing ran.
 *
 * `import type` and `export type` are exempt: TypeScript erases them, so they
 * produce no runtime resolution at all. That is not a nicety — every
 * extensionless specifier in the sibling typescript-client package is a type
 * import, which is why that package works and this check must not flag it.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every package.json declaring "type": "module", with its src directory. */
const PACKAGES = [
  'citadel-workspace-client-ts',
  join('citadel-internal-service', 'typescript-client'),
].filter((pkg) => {
  const manifest = join(ROOT, pkg, 'package.json');
  if (!existsSync(manifest)) return false;
  return JSON.parse(readFileSync(manifest, 'utf8')).type === 'module';
});

if (PACKAGES.length === 0) {
  console.error('No ESM packages found — this check verified nothing. Did a path move?');
  process.exit(1);
}

function sources(dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sources(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) found.push(full);
  }
  return found;
}

const problems = [];
let scanned = 0;

for (const pkg of PACKAGES) {
  for (const file of sources(join(ROOT, pkg, 'src'))) {
    scanned += 1;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // Comments first. This gate's own first run flagged
        // typescript-client/src/index.ts:3 — a line reading "// To use
        // CitadelClient in Node.js, import directly: import { CitadelClient }
        // from './CitadelClient'". Prose that quotes an import is not an
        // import, and a guard that reads documentation reports on nothing.
        const code = line.replace(/\/\/.*$/, '');
        if (/^\s*[*]/.test(line)) return;
        // Erased at compile time, so no runtime resolution happens.
        if (/^\s*(import|export)\s+type\b/.test(code)) return;
        const m = /\b(?:from|import)\s+'(\.[^']*)'/.exec(code);
        if (!m) return;
        const specifier = m[1];
        if (/\.[a-zA-Z0-9]+$/.test(specifier)) return;
        problems.push(`${relative(ROOT, file)}:${i + 1}  ${specifier}`);
      });
  }
}

if (scanned === 0) {
  console.error('Scanned no source files — this check verified nothing.');
  process.exit(1);
}

if (problems.length > 0) {
  console.error('Relative imports without an extension, in packages declaring "type": "module":\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nNode's ESM resolver requires the extension. TypeScript and Vite do not, so\n" +
      'this builds and typechecks while being unimportable by Node. Append `.js`\n' +
      '(the EMITTED name, not `.ts`), or make it `import type` if it is types only.',
  );
  process.exit(1);
}

console.log(`ESM imports OK: ${scanned} file(s) across ${PACKAGES.length} package(s), all resolvable.`);
