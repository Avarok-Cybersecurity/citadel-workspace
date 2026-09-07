#!/usr/bin/env node
/**
 * Every workflow file must be valid YAML.
 *
 * Nothing checked this. `check-expensive-jobs-wait-for-cheap-ones.mjs` reads
 * both workflows with regexes and deliberately avoids a YAML dependency, so a
 * syntax error passes every gate in the repository -- verified by breaking
 * validate.yml on purpose and watching preflight stay green.
 *
 * What that costs: GitHub does not run a workflow it cannot parse, and does not
 * say why in the run. It reports "this run cannot be rerun; its workflow file
 * may be broken", or simply queues nothing. The push looks fine, CI looks idle,
 * and the mistake is a bracket somewhere in 2,500 lines.
 *
 * This gate is the cheapest possible answer: parse them. It asserts nothing
 * about content -- the semantic checks already exist and are better placed --
 * only that the file GitHub will read is readable.
 *
 * js-yaml is a devDependency and this FAILS rather than skips when it is
 * missing. A gate that quietly does nothing when its parser is absent is worse
 * than no gate: it reports safety on exactly the runs where it checked least.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = ['.github/workflows', 'citadel-workspaces/.github/workflows'];

let load;
try {
  ({ load } = await import('js-yaml'));
} catch {
  console.error(
    '\n  js-yaml is not installed, so the workflows were not parsed.\n\n' +
    '  Run `npm ci` at the repository root. This fails rather than skipping:\n' +
    '  a check that passes when its parser is missing reports safety on the\n' +
    '  runs where it verified least.\n',
  );
  process.exit(1);
}

const files = DIRS.filter((d) => existsSync(d))
  .flatMap((d) => readdirSync(d).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(d, f)));

if (files.length < 2) {
  console.error(`\n  Found only ${files.length} workflow file(s). The layout moved; fix this reader.\n`);
  process.exit(1);
}

const broken = [];
for (const f of files) {
  try {
    const doc = load(readFileSync(f, 'utf8'));
    if (!doc || typeof doc !== 'object' || !doc.jobs) {
      broken.push(`${f}: parses, but has no \`jobs:\` map — GitHub would run nothing`);
    }
  } catch (error) {
    broken.push(`${f}: ${String(error).split('\n')[0]}`);
  }
}

if (broken.length > 0) {
  for (const b of broken) console.error(`::error::${b}`);
  console.error(
    `\n  ${broken.length} workflow file(s) GitHub could not run:\n\n` +
    broken.map((b) => `    ${b}`).join('\n') +
    '\n\n  GitHub does not report this in the run — it queues nothing, or says\n' +
    '  "this run cannot be rerun; its workflow file may be broken".\n',
  );
  process.exit(1);
}

console.log(`workflows parse: ${files.length} file(s), all with a jobs map.`);
