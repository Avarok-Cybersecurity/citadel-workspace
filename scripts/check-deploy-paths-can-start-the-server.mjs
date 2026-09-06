/**
 * Nothing may build or run the server image behind `deploy.sh`'s back.
 *
 * Two scripts pointed at the production host each carried their own deploy, and
 * neither could start the server:
 *
 *   - `docker build -f docker/workspace-server/Dockerfile .` with no `--target`
 *     builds the LAST stage in that file, which is `dev` (`FROM builder AS dev`)
 *     — the toolchain image, not `production`. It also compiled Rust on the
 *     production host, which deploy.sh removed deliberately.
 *
 *   - `docker run ... citadel-workspace-server` passed no
 *     `WORKSPACE_MASTER_PASSWORD` and no env file. The kernel refuses to start
 *     without one (citadel-workspace-server-kernel/src/main.rs:49), so the
 *     container exited immediately and `--restart unless-stopped` looped it.
 *
 * The operator then saw `nc -zv 127.0.0.1 12349` fail and was told the PORT was
 * shut. Every layer reported something true and none of them reported the cause.
 *
 * `deploy.sh` already does this properly — it validates `.env` before touching
 * anything, pulls prebuilt images, checks they share a commit, and leaves the
 * data volumes alone. A second implementation of the same job is a second thing
 * to keep correct, and this one was not.
 *
 * The rule, for scripts that reach the production host: build the server image
 * only with an explicit `--target`, and do not `docker run` it directly. Deploy
 * through `deploy.sh` or `docker compose`, which supply the configuration.
 *
 * NOT covered, deliberately: `docker compose` files and the CI workflows. Compose
 * supplies `environment:` from the file, and CI builds with explicit targets and
 * runs the dev stack on purpose. This is about the ad-hoc scripts an operator
 * runs by hand, which is where the missing configuration goes unnoticed.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The server image, by the name these scripts give it. */
const SERVER_IMAGE = /citadel-workspace-server\b/;

/** A build of the server Dockerfile. */
const BUILDS_SERVER = /docker\s+build\b[^\n]*docker\/workspace-server\/Dockerfile/;

/** `docker run` of that image, as opposed to `docker compose up`. */
const RUNS_SERVER = /docker\s+run\b[^\n]*citadel-workspace-server/;

const problems = [];
let scriptsRead = 0;

// Top-level operator scripts only. A script inside docker/ or scripts/ is part of
// the build system rather than something typed at a production host.
const scripts = readdirSync(ROOT).filter((f) => f.endsWith('.sh'));

if (scripts.length === 0) {
  console.error('FAIL: no top-level *.sh found — the layout moved and this gate read nothing.');
  process.exit(1);
}

for (const name of scripts) {
  const path = join(ROOT, name);
  if (!existsSync(path)) continue;
  scriptsRead += 1;
  const lines = readFileSync(path, 'utf8').split('\n');

  lines.forEach((line, i) => {
    // A comment cannot deploy anything, and both scripts now explain the defect
    // at length — matching those would make this gate unfixable.
    if (/^\s*#/.test(line)) return;

    if (BUILDS_SERVER.test(line) && !/--target/.test(line)) {
      problems.push(
        `${name}:${i + 1}: builds the server Dockerfile with no \`--target\`, which selects the ` +
          'LAST stage (`dev`), not `production`',
      );
    }
    if (RUNS_SERVER.test(line) && SERVER_IMAGE.test(line)) {
      const suppliesConfig = /--env-file|-e\s+WORKSPACE_MASTER_PASSWORD|\$\{?WORKSPACE_MASTER_PASSWORD/.test(line);
      if (!suppliesConfig) {
        problems.push(
          `${name}:${i + 1}: \`docker run\` of the server image with no WORKSPACE_MASTER_PASSWORD ` +
            'and no --env-file; the kernel refuses to start and the container will crash-loop',
        );
      }
    }
  });
}

// Vacuity floor: these scripts exist. Reading none means the walk moved.
if (scriptsRead < 3) {
  console.error(
    `FAIL: read only ${scriptsRead} top-level script(s); the layout moved and this gate\n` +
      'examined essentially nothing.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} deploy path(s) cannot start the server.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nDeploy through `deploy.sh` (or `docker compose`), which supplies the configuration,\n' +
      'validates the master password before touching anything, and pulls prebuilt images\n' +
      'rather than compiling Rust on the production host.\n' +
      '\nThe last time these diverged, the operator was shown a closed port and the cause was\n' +
      'a missing environment variable.',
  );
  process.exit(1);
}

console.log(
  `check-deploy-paths-can-start-the-server: ${scriptsRead} top-level script(s); none builds the ` +
    'server image without a target or runs it without its configuration.',
);
