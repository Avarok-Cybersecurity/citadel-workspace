/**
 * A script that reaches the production host must read that host's configuration,
 * not a literal it was written next to.
 *
 * Round 630 collapsed two operator scripts into thin wrappers around the
 * `deploy.sh` that runs ON the host. The deploy part was right. Two assumptions
 * inside it were not, and neither could fail in the environment it was written
 * in — only in the one it runs in:
 *
 *   1. `AVAROK_REMOTE_DIR` defaulted to `~/development/citadel-workspace-server`,
 *      a stale source checkout with no `deploy.sh` in it. The real deployment is
 *      `/srv/citadel-tenants/avarok`. Every run died on
 *      `./deploy.sh: No such file or directory`, which reads as a broken deploy
 *      rather than a script pointed at the wrong directory.
 *
 *   2. The post-deploy check was `nc -z 127.0.0.1 12349`. The deployed server
 *      binds whatever `WORKSPACE_BIND_ADDR` in the host's `.env` says, which is
 *      12400 on avarok2. So the check reported a CLOSED PORT on a server that
 *      was serving real sessions, and the wrapper exited 1 on it.
 *
 * The second one is the reason this gate exists rather than a comment. The
 * scripts' own header already described that exact failure -- an operator shown
 * a closed port when the configuration was wrong -- as the defect being fixed.
 * It was removed from one place in the file and left in another, four lines
 * apart. Reading the file is evidently not enough.
 *
 * Two rules, both decidable from the text:
 *
 *   - A port probe (`nc -z`) in a top-level script must take its port from a
 *     variable. A literal is a copy of configuration that lives elsewhere.
 *   - A script that runs a remote `./deploy.sh` must first test that it is
 *     there, so the error names the wrong directory instead of the deploy.
 *
 * NOT covered: whether the DEFAULT path is the right one. Nothing in this repo
 * can know that -- it took an `ls` on the host. What the gate can do is make the
 * failure say which assumption was wrong.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `nc -z <host> 12349` — a literal port. `nc -z <host> "$port"` is fine. */
const LITERAL_PORT_PROBE = /\bnc\s+(?:-[A-Za-z]+\s+)*-z[A-Za-z]*\s+(?:-[A-Za-z0-9]+\s+)*\S+\s+(\d{2,5})\b/;

/** Any `nc -z` at all, literal or not — the vacuity floor for rule 1. */
const ANY_PORT_PROBE = /\bnc\s+(?:-[A-Za-z]+\s+)*-z/;

/** Running the deploy that lives on the host. */
const RUNS_REMOTE_DEPLOY = /\.\/deploy\.sh/;

/** Checking it is there first, by any of the shapes that actually check. */
const TESTS_FOR_DEPLOY = /test\s+-[a-z]+\s+\S*deploy\.sh|\[\s+-[a-z]+\s+\S*deploy\.sh/;

const problems = [];
let scriptsRead = 0;
let probesSeen = 0;
let deployRunnersSeen = 0;

const scripts = readdirSync(ROOT).filter((f) => f.endsWith('.sh'));
if (scripts.length === 0) {
  console.error('FAIL: no top-level *.sh found — the layout moved and this gate read nothing.');
  process.exit(1);
}

for (const name of scripts) {
  scriptsRead += 1;
  const source = readFileSync(join(ROOT, name), 'utf8');
  const lines = source.split('\n');

  const executable = lines
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*#/.test(line)); // a comment probes nothing

  for (const { line, n } of executable) {
    if (ANY_PORT_PROBE.test(line)) probesSeen += 1;
    const literal = line.match(LITERAL_PORT_PROBE);
    if (literal) {
      problems.push(
        `${name}:${n}: probes port ${literal[1]} as a literal; the deployed server binds ` +
          "whatever the host's `.env` says (WORKSPACE_BIND_ADDR), so this reports a closed " +
          'port on a server that is serving',
      );
    }
  }

  const runsDeploy = executable.some(({ line }) => RUNS_REMOTE_DEPLOY.test(line));
  if (runsDeploy) {
    deployRunnersSeen += 1;
    if (!executable.some(({ line }) => TESTS_FOR_DEPLOY.test(line))) {
      problems.push(
        `${name}: runs a remote \`./deploy.sh\` without first testing that it exists; the ` +
          'failure then names the deploy rather than the directory the script was pointed at',
      );
    }
  }
}

// Vacuity floors, one per rule. Both shapes exist in this repo; finding neither
// means the walk or the pattern moved, and a clean bill over that is the exact
// failure this gate is about.
if (scriptsRead < 3 || probesSeen === 0 || deployRunnersSeen === 0) {
  console.error(
    `FAIL: read ${scriptsRead} script(s), ${probesSeen} port probe(s), ` +
      `${deployRunnersSeen} remote-deploy caller(s).\n` +
      'A zero on either count means this gate examined nothing for that rule.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} remote check(s) that read a literal, not the deployment.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nRead the port from the host's `.env` (`WORKSPACE_BIND_ADDR`), and test for `deploy.sh`\n" +
      'before running it. The deployment is `/srv/citadel-tenants/avarok`, not the source\n' +
      'checkout beside it, and its port is 12400, not the dev stack\'s 12349.\n' +
      '\nThe last time this was wrong, an operator was shown a closed port on a server that\n' +
      'was serving real sessions.',
  );
  process.exit(1);
}

console.log(
  `check-remote-checks-read-the-deployment: ${scriptsRead} top-level script(s), ` +
    `${probesSeen} port probe(s), ${deployRunnersSeen} remote-deploy caller(s); ` +
    'none reads a literal port and none runs a deploy it did not look for.',
);
