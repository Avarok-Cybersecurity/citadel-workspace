// Which CI jobs may run on the self-hosted Mac pool, decided from workflow TEXT.
//
// Every repository here is public, so a pull request from a fork is code written
// by anybody. GitHub's own advice is never to run that on a self-hosted machine:
// the runner keeps state between jobs and holds whatever the box can reach. The
// only thing between a fork's PR and this hardware is one expression in
// `runs-on`. So the expression is not left to each job's author -- there is ONE
// accepted shape, and anything else that names the pool is a failure:
//
//   ${{ [matrix.<k> == '<v>' && ]vars.CITADEL_MAC_RUNNER == '1'
//       && (github.event_name != 'pull_request'
//           || github.event.pull_request.head.repo.full_name == github.repository)
//       && fromJSON('["self-hosted","macOS","ARM64","apple-48gb-metal"]')
//       || '<hosted label>' | matrix.<k> }}
//
// Unset, the variable sends every job to its hosted fallback, so flipping it off
// is the whole escape hatch when the Mac is down. The guard only understands
// `pull_request`: under `pull_request_target`, `issue_comment` or `workflow_run`
// `github.event_name` is something else, the guard is TRUE, and a fork's code
// could land here. Those triggers are therefore refused outright for any
// workflow that routes to the pool, including one reached through
// `workflow_call` from such a workflow.
//
// Dependency-free on purpose: the gates job installs nothing (see the js-yaml
// history in check-ci-job-timeouts.mjs). citadel-agent carries a copy in
// .github/scripts/ because it routes to the same machine; keep them identical.

export const OPT_IN = "vars.CITADEL_MAC_RUNNER == '1'";
export const SAME_REPO_GUARD =
  "(github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)";
export const POOL = `fromJSON('["self-hosted","macOS","ARM64","apple-48gb-metal"]')`;
/** Anything that reaches the pool, however it is spelled. */
const POOL_TOKENS = /self-hosted|apple-48gb-metal|CITADEL_MAC_RUNNER/;
/** Triggers whose `github.event_name` the guard reasons about correctly. */
const SAFE_TRIGGERS = new Set(['pull_request', 'push', 'workflow_dispatch', 'schedule', 'workflow_call', 'merge_group']);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CANONICAL = new RegExp(
  '^\\$\\{\\{ ' +
  "(?:matrix\\.[A-Za-z0-9_-]+ == '[^']+' && )?" +
  `${esc(OPT_IN)} && ${esc(SAME_REPO_GUARD)} && ${esc(POOL)} \\|\\| ` +
  "(?:'(?<label>[^']+)'|matrix\\.[A-Za-z0-9_-]+) \\}\\}$",
);

/** A line with its comment removed, unless the `#` sits inside quotes. */
function stripComment(line) {
  if (/^\s*#/.test(line)) return '';
  const hash = line.search(/\s#/);
  if (hash < 0) return line;
  const before = line.slice(0, hash);
  const quotes = (before.match(/'/g) || []).length + (before.match(/"/g) || []).length;
  return quotes % 2 === 0 ? before : line;
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/** The workflow's trigger names, from a block or an inline `on:`. */
export function triggersOf(source) {
  const lines = source.split('\n').map(stripComment);
  const start = lines.findIndex((l) => /^(on|"on"|'on'|true):/.test(l));
  if (start < 0) return [];
  const inline = lines[start].replace(/^[^:]+:\s*/, '').trim();
  if (inline) return inline.replace(/[[\]]/g, '').split(',').map((t) => t.trim()).filter(Boolean);
  const found = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const key = line.match(/^ {2}([A-Za-z_]+):/);
    if (key) found.push(key[1]);
  }
  return found;
}

/**
 * Jobs as { name, runsOn, strategy, calls }. `strategy` is the matrix text: the
 * only other place a runner label can come from, since runs-on may read it.
 */
export function jobsOf(source) {
  const lines = source.split('\n').map(stripComment);
  const jobs = [];
  let inJobs = false;
  let job = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (/^\S/.test(line)) { inJobs = false; job = null; continue; }
    const key = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (key) { job = { name: key[1], runsOn: null, strategy: [], calls: null, inStrategy: false }; jobs.push(job); continue; }
    if (!job) continue;
    const call = line.match(/^ {4}uses:\s*(\S+)/);
    if (call) job.calls = call[1];
    if (/^ {4}\S/.test(line)) job.inStrategy = /^ {4}strategy:/.test(line);
    if (job.inStrategy) job.strategy.push(line);
    const runsOn = line.match(/^ {4}runs-on:\s*(.*)$/);
    if (!runsOn) continue;
    let value = runsOn[1].trim();
    if (/^[>|][-+]?$/.test(value)) {
      value = '';
      while (i + 1 < lines.length && (/^ {6,}\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) value += ` ${lines[++i]}`;
    }
    job.runsOn = collapse(value).replace(/^(['"])(.*)\1$/, '$2');
  }
  return jobs.map(({ inStrategy, ...j }) => ({ ...j, strategy: j.strategy.join('\n') }));
}

/** Is this `runs-on` the one accepted shape? Returns null when it is, else why not. */
export function routingProblem(runsOn) {
  const match = CANONICAL.exec(runsOn ?? '');
  if (!match) {
    return 'names the Mac pool without the one accepted runs-on expression (opt-in variable, same-repo guard, pool array, hosted fallback)';
  }
  if (match.groups.label && POOL_TOKENS.test(match.groups.label)) {
    return `falls back to '${match.groups.label}', which is the pool itself: with the variable unset it still runs here`;
  }
  return null;
}

/**
 * Judge every workflow at once, because a reusable workflow is only as safe as
 * whatever calls it. `files` is [{ name, source }]; returns { problems, jobs, routed }.
 */
export function judge(files) {
  const problems = [];
  let jobs = 0;
  const routed = [];
  const parsed = files.map(({ name, source }) => ({ name, triggers: triggersOf(source), jobs: jobsOf(source) }));
  const routesToPool = new Set();
  for (const wf of parsed) {
    for (const job of wf.jobs) {
      jobs += 1;
      const where = `${wf.name}:${job.name}`;
      const inRunsOn = POOL_TOKENS.test(job.runsOn ?? '');
      if (POOL_TOKENS.test(job.strategy)) {
        problems.push(`${where} names the Mac pool in its matrix; a matrix value cannot carry the guard`);
      }
      if (!inRunsOn) continue;
      routesToPool.add(wf.name);
      routed.push(where);
      const why = routingProblem(job.runsOn);
      if (why) problems.push(`${where} ${why}`);
      const unsafe = wf.triggers.filter((t) => !SAFE_TRIGGERS.has(t));
      if (unsafe.length) {
        problems.push(`${where} routes to the Mac pool in a workflow triggered by ${unsafe.join(', ')}; the same-repo guard only recognises pull_request, so a fork's code could run there`);
      }
    }
  }
  for (const wf of parsed) {
    const unsafe = wf.triggers.filter((t) => !SAFE_TRIGGERS.has(t));
    if (!unsafe.length) continue;
    for (const job of wf.jobs) {
      const callee = job.calls?.match(/^\.\/\.github\/workflows\/(.+)$/)?.[1];
      if (callee && routesToPool.has(callee)) {
        problems.push(`${wf.name}:${job.name} calls ${callee}, which routes to the Mac pool, from ${unsafe.join(', ')}; the callee's guard cannot tell that event from a trusted one`);
      }
    }
  }
  return { problems, jobs, routed };
}
