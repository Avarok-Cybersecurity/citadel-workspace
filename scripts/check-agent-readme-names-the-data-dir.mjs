/**
 * The agent README must name the directory the agent really writes to.
 *
 * That directory IS the tester's account: identity and key material, with no
 * server-side copy. The README said `./internal-service-data` while the binary
 * defaulted to `./data`, so a tester who backed up the documented directory
 * backed up nothing, and one who deleted `./data` to "reset" lost the account.
 *
 * The default is read from the agent's own backend selection
 * (`data_dir_choice.unwrap_or("<dir>")`), never listed here.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = 'citadel-workspace-internal-service/src/main.rs';
const README = 'docs/AGENT_README.md';

const agent = readFileSync(join(ROOT, AGENT), 'utf8');
const defaults = [...new Set([...agent.matchAll(/data_dir_choice\.unwrap_or\("([^"]+)"\)/g)].map((m) => m[1]))];
if (defaults.length !== 1) {
  console.error(`FAIL: expected one data-dir default in ${AGENT}, found ${defaults.length} (${defaults.join(', ')}).`);
  process.exit(1);
}
const [dir] = defaults;

const readme = readFileSync(join(ROOT, README), 'utf8');
// Every inline `./path` except the binary itself (`./citadel-agent`, `.exe`).
const named = [...readme.matchAll(/`(\.\/[A-Za-z0-9_.-]+)`/g)].map((m) => m[1]).filter((d) => !d.startsWith('./citadel-agent'));
const wrong = [...new Set(named.filter((d) => d !== dir))];
if (!named.includes(dir) || wrong.length > 0) {
  console.error(
    `FAIL: the agent writes the account to \`${dir}\` by default (${AGENT}), but ${README} ` +
      (named.includes(dir) ? '' : `never names it`) +
      (wrong.length ? `${named.includes(dir) ? '' : ' and '}names ${wrong.map((d) => `\`${d}\``).join(', ')} instead` : '') +
      '.\nA tester backs up, moves or deletes the directory the README names.',
  );
  process.exit(1);
}
console.log(`check-agent-readme-names-the-data-dir: ${README} names \`${dir}\`, the agent's default (${AGENT}).`);
