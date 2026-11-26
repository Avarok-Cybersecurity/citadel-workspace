/**
 * The cargo checks CI runs in a cargo workspace the hooks have no hand-written checks for (pure).
 *
 * preflight runs fmt, clippy and tests for two workspaces it names: the root and the agent. Every
 * other cargo workspace -- each first-party app, the SDK fixtures and their harness, the guest SDK --
 * has its own Cargo.lock and toolchain, and CI checks it in the Apps SDK job. No hook did, so a push
 * passed 231 checks while compute-pool's `cargo clippy -D warnings` was red. These are read from
 * validate.yml, so the hooks run exactly CI's commands, in CI's directories, and a workspace CI adds
 * is covered without anyone listing it here.
 */
import { readJobs, stepRuns, substitute } from './workflow-steps.mjs';

const CARGO = /^cargo(\s+\+[A-Za-z0-9._-]+)?\s+(fmt|clippy|test|nextest\s+run)(\s|$)/;
const UNSAFE = /[|;<>`$(){}&\\]/;

/**
 * @param {{ text: string, covered: string[] }} input covered: workspace directories (repo-relative, '.' for
 *   the root) whose checks preflight already names
 * @returns {{ wd: string, argv: string[], sources: string[] }[]} one per distinct directory and command
 */
export function cargoGates({ text, covered }) {
  const found = new Map();
  for (const job of readJobs(text)) {
    for (const row of job.rows) {
      for (const step of job.steps) {
        if (step.run === null || !stepRuns(step.if, row)) continue;
        const wd = substitute(step.wd ?? job.defaultWd ?? '.', row).replace(/\/+$/, '') || '.';
        if (covered.includes(wd)) continue;
        for (const line of substitute(step.run, row).split('\n').map((l) => l.trim())) {
          if (!CARGO.test(line)) continue;
          if (UNSAFE.test(line)) throw new Error(`job '${job.id}': cannot run \`${line}\` as one command`);
          const key = `${wd}\0${line}`;
          const known = found.get(key);
          if (known) known.sources.push(job.id);
          else found.set(key, { wd, argv: line.split(/\s+/), sources: [job.id] });
        }
      }
    }
  }
  return [...found.values()];
}

