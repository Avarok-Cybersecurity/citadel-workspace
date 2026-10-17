/**
 * The gate commands a workflow runs, each with the directory and environment CI gives it.
 *
 * Pure. preflight.mjs feeds it the parent's and the UI repo's validate.yml; tests feed it
 * strings. A gate is one of:
 *
 *   node scripts/<name>.mjs [args]    node --test <files>
 *   npm run check:<name>              npm test
 *
 * plus `npm run build` when it is the first link of a chain ending in a gate
 * (`npm run build && npm run check:bundle`): the gate reads what the build wrote.
 */
import { readJobs, stepRuns, substitute, workflowEnv } from './workflow-steps.mjs';

const GATE = /^(node\s+(--test\s+\S|(\.\.\/)?scripts\/[A-Za-z0-9_/-]+\.mjs)|npm\s+run\s+check:[a-z0-9:-]+$|npm\s+test$)/;
const PREREQUISITE = /^npm\s+run\s+build$/;
const UNSAFE = /[|;<>`$(){}]/;
/**
 * A job that installs a browser or brings Docker up runs gates that need more than the source:
 * a build, a browser, a served app. Such a gate is `heavy` only if EVERY job that runs it is --
 * the file-length gate runs in the Docker job too, and in a plain lint job.
 */
const HEAVY = /playwright install|docker compose/;

/** Split one command into argv: whitespace, with '…' and "…" kept whole. */
export function argv(command) {
  const out = [];
  for (const m of command.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * The gate commands in one `run:` body, as chains of argv. A chain is the gate plus any
 * prerequisite before it on the same `&&` line. Lines that are not gates are not ours
 * (installs, shell logic, the integration suites) and are ignored.
 */
export function gateChains(run) {
  const joined = run.replace(/\\\n\s*/g, ' ');
  const chains = [];
  for (const raw of joined.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const parts = line.split('&&').map((p) => p.trim());
    let pending = [];
    for (const part of parts) {
      // A matrix reference left in place means the matrix was misread, and a gate behind it is hidden.
      if (/\$\{\{\s*matrix\./.test(part)) throw new Error(`an unexpanded expression in '${part}'`);
      if (GATE.test(part)) {
        if (part.includes('${{')) throw new Error(`an unexpanded expression in gate command '${part}'`);
        if (UNSAFE.test(part)) throw new Error(`gate command '${part}' needs a shell; preflight runs argv only`);
        chains.push([...pending, argv(part)]);
        pending = [];
      } else if (PREREQUISITE.test(part)) {
        pending.push(argv(part));
      } else {
        pending = [];
      }
    }
  }
  return chains;
}

const literal = (env) => Object.fromEntries(Object.entries(env).filter(([, v]) => !String(v).includes('${{')));

/** A short human label for one argv. */
export function label(command) {
  const [cmd, ...rest] = command;
  if (cmd === 'npm') return rest.join(' ');
  if (rest[0] === '--test') return `node --test ${rest.slice(1).join(' ')}`;
  const [script, ...args] = rest;
  const name = script.split('/').pop().replace(/\.mjs$/, '').replace(/^check-/, '').replace(/-/g, ' ');
  return [name, ...args].join(' ');
}

/**
 * Every gate in a workflow, expanded over each job's matrix rows and deduplicated. Pass `seen`
 * to deduplicate across workflows: a gate both repos run is run once, and keeps both sources.
 *
 * `resolveDir(workspacePath)` maps a CI working directory (relative to GITHUB_WORKSPACE, as
 * both a step's `working-directory:` and a job's default are) to a local one, and throws for a
 * directory that has no local counterpart.
 */
export function deriveGates({ text, source, resolveDir, seen }) {
  const topEnv = literal(workflowEnv(text));
  const gates = [];
  for (const job of readJobs(text)) {
    for (const row of job.rows) {
      for (const step of job.steps) {
        if (step.run === null || !stepRuns(step.if, row)) continue;
        let chains;
        try {
          chains = gateChains(substitute(step.run, row));
        } catch (error) {
          throw new Error(`${source} job '${job.id}' step '${step.name ?? step.run}': ${error.message}`);
        }
        if (chains.length === 0) continue;
        const wd = substitute(step.wd ?? job.defaultWd ?? '.', row);
        if (wd.includes('${{')) throw new Error(`${source} job '${job.id}': cannot resolve working-directory '${wd}'`);
        const cwd = resolveDir(wd);
        const env = { ...topEnv, ...literal(job.env), ...literal(step.env) };
        const heavy = job.steps.some((s) => HEAVY.test(s.run ?? ''));
        for (const chain of chains) {
          for (const [i, command] of chain.entries()) {
            const key = `${cwd}\0${command.join(' ')}`;
            const known = seen.get(key);
            if (known) {
              known.sources.push(`${source}:${job.id}`);
              known.heavy = known.heavy && heavy;
              if (job.nodeMajor !== null) known.nodeMajors.add(job.nodeMajor);
              continue;
            }
            const prerequisite = i < chain.length - 1;
            const gate = {
              label: prerequisite ? `${label(command)} (for ${label(chain[chain.length - 1])})` : label(command),
              argv: command,
              cwd,
              env,
              sources: [`${source}:${job.id}`],
              nodeMajors: new Set(job.nodeMajor === null ? [] : [job.nodeMajor]),
              prerequisite,
              heavy,
            };
            seen.set(key, gate);
            gates.push(gate);
          }
        }
      }
    }
  }
  return gates;
}

/**
 * The Node major preflight must run under, and where CI disagrees with itself.
 *
 * Each gate counts once, for every major a job that runs it pins with setup-node (a job with no
 * setup-node takes whatever the runner ships, which says nothing about what CI chose). The
 * required major is the one that covers the most gates; `elsewhere` lists the gates CI runs ONLY
 * under some other major, which a single local Node cannot match and preflight reports.
 */
export function nodeRequirement(gates) {
  const covered = new Map();
  for (const gate of gates) for (const major of gate.nodeMajors) covered.set(major, (covered.get(major) ?? 0) + 1);
  if (covered.size === 0) throw new Error('no gate-running job pins a Node version with actions/setup-node');
  const ranked = [...covered].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    throw new Error(`CI's gate jobs are split evenly between Node ${ranked[0][0]} and ${ranked[1][0]}; pin one in the workflows`);
  }
  const [major] = ranked[0];
  const elsewhere = gates
    .filter((g) => g.nodeMajors.size > 0 && !g.nodeMajors.has(major))
    .map((g) => ({ label: g.label, majors: [...g.nodeMajors] }));
  return { major, covered, elsewhere };
}
