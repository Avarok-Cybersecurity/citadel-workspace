/**
 * What the workflows can produce, against what branch protection and the release require. Pure:
 * workflow text in, findings out; scripts/check-workflow-graph.mjs reads the files and
 * scripts/merge-blockability.mjs the live protection. Three rules, each from a failure:
 *
 *   (a) Every required status check is a name some pull_request workflow produces. On
 *       citadel-internal-service the rule required "tests (ubuntu-latest)" while the matrix said
 *       ubuntu-24.04, so the job ran green under "tests (ubuntu-24.04)" and the required one waited
 *       forever: release/robust-1119 could not merge (2026-11-21). A required name nothing produces
 *       never fails -- it stays "expected", which reads as "still running".
 *   (b) Every local action and build target the release uses is exercised by a PR job, or is
 *       allowlisted with a reason. Runs 44939018558 (a Windows home path in the shipped binary) and
 *       44958340345 (the Linux musl leg's remap flags) failed only at release, because no PR job
 *       built what the release builds; windows-agent and unix-agents were added after them.
 *   (c) No workflow dispatches another with a raw `gh workflow run` or a POST to
 *       actions/workflows/<file>/dispatches. Run 44966593936's "Start the deploy" died on an API
 *       timeout, possibly after the dispatch had landed; scripts/dispatch-workflow.mjs checks
 *       before it retries, a raw call cannot.
 *
 * Check names follow GitHub's rule: a job's `name:` (else its id); with a matrix, the name with
 * `${{ matrix.* }}` substituted, or -- when the name names no matrix value -- the row's values
 * appended as " (a, b)"; a job calling a reusable workflow prefixes each callee check "caller / ".
 */
import { readJobs, substitute } from './workflow-steps.mjs';

/** Events that put checks on a pull request, so the ones a required check can come from. */
const PR_EVENTS = new Set(['pull_request', 'pull_request_target', 'merge_group']);
const LOCAL_ACTION = /uses:\s*['"]?\.\/\.github\/actions\/([A-Za-z0-9_.-]+)/g;
const RAW_DISPATCH = [/\bgh\s+workflow\s+run\b/, /actions\/workflows\/[^\s/'"]+\/dispatches/];

const code = (text) => text.split('\n').map((line) => (/^\s*#/.test(line) ? '' : line));

/** The events in `on:`, in its block, list or scalar form. */
export function triggers(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => /^on:/.test(line));
  if (at < 0) throw new Error('workflow: no top-level `on:` key');
  const inline = lines[at].replace(/^on:\s*/, '').replace(/\s+#.*$/, '').trim();
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map((e) => e.trim()).filter(Boolean);
  const events = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^ {2}([A-Za-z_]+):/.exec(line);
    if (m) events.push(m[1]);
  }
  return events;
}

function expand(base, rows) {
  if (rows.length === 1 && Object.keys(rows[0]).length === 0) return [base];
  const strategy = (name, i) => name
    .replace(/\$\{\{\s*strategy\.job-total\s*\}\}/g, String(rows.length))
    .replace(/\$\{\{\s*strategy\.job-index\s*\}\}/g, String(i));
  if (/\$\{\{\s*(matrix|strategy)\./.test(base)) return rows.map((row, i) => strategy(substitute(base, row), i));
  return rows.map((row) => `${base} (${Object.values(row).join(', ')})`);
}

/** Every check name one workflow produces. `readCallee(uses)` returns a reusable workflow's text. */
export function checkNames(text, readCallee) {
  const names = [];
  for (const job of readJobs(text)) {
    const own = expand(job.name ?? job.id, job.rows);
    if (!job.uses) {
      names.push(...own);
      continue;
    }
    if (!job.uses.startsWith('./')) throw new Error(`job ${job.id} calls ${job.uses}; only local reusable workflows are read`);
    const inner = checkNames(readCallee(job.uses), readCallee);
    for (const caller of own) for (const callee of inner) names.push(`${caller} / ${callee}`);
  }
  return names;
}

/** The names a pull request can receive from these workflows ({ path, text }[]). */
export function producedOnPullRequests(workflows, readCallee) {
  const produced = new Set();
  let examined = 0;
  for (const { text } of workflows) {
    if (!triggers(text).some((e) => PR_EVENTS.has(e))) continue;
    examined += 1;
    for (const name of checkNames(text, readCallee)) produced.add(name);
  }
  return { produced, examined };
}

/** Required names nothing produces, each with the produced names that look like what was meant. */
export function unproducedRequired(required, produced, external) {
  const stem = (name) => name.split(' (')[0];
  return required
    .filter((name) => !produced.has(name) && !external.includes(name))
    .map((name) => ({ name, near: [...produced].filter((p) => stem(p) === stem(name)).sort() }));
}

/** Local actions a workflow uses, by name. */
export function localActions(text) {
  return new Set([...code(text).join('\n').matchAll(LOCAL_ACTION)].map((m) => m[1]));
}

/** The Rust targets of release-agent.yml's `build` matrix. */
export function releaseTargets(text) {
  const build = readJobs(text).find((job) => job.id === 'build');
  if (!build) throw new Error('release workflow: no `build` job');
  const targets = build.rows.map((row) => row.target).filter((t) => typeof t === 'string');
  if (targets.length === 0) throw new Error('release workflow: the `build` matrix names no target');
  return targets;
}

/**
 * Release actions and targets no PR job exercises and nothing allowlists, plus allowlist entries
 * that no longer earn their place. `twins[action]` lists paths validate.yml must invoke instead
 * of the action itself (its compile step, say, without the release's signing).
 */
export function releaseOnlyGaps({ releaseActions, targets, validateText, twins, allowed }) {
  const pr = code(validateText).join('\n');
  const prActions = localActions(validateText);
  const problems = [];
  for (const action of [...releaseActions].sort()) {
    const twin = twins[action];
    const twinned = Array.isArray(twin) && twin.length > 0 && twin.every((path) => pr.includes(path));
    if (prActions.has(action) || twinned) {
      if (allowed[action] !== undefined) problems.push(`${action} is allowlisted as release-only, but a PR job exercises it: drop the entry`);
      continue;
    }
    if (twin !== undefined) {
      const absent = (Array.isArray(twin) ? twin : []).filter((path) => !pr.includes(path));
      problems.push(`${action}'s PR twin is missing: validate.yml does not invoke ${absent.join(', ') || '(an empty twin list)'}`);
      continue;
    }
    const reason = allowed[action];
    if (typeof reason !== 'string' || reason.trim().length < 20) {
      problems.push(`${action} runs only at release: exercise it in validate.yml, name its twin, or allowlist it with a reason`);
    }
  }
  for (const action of Object.keys(allowed)) {
    if (!releaseActions.has(action)) problems.push(`${action} is allowlisted as release-only but no release workflow uses it: drop the entry`);
  }
  for (const target of targets) {
    if (!pr.includes(target)) problems.push(`the release builds ${target}, and no PR job does`);
  }
  return problems;
}

/** Steps that dispatch a workflow without scripts/dispatch-workflow.mjs. */
export function rawDispatches(text) {
  return code(text)
    .map((line, i) => ({ line: i + 1, text: line.trim() }))
    .filter(({ text: line }) => RAW_DISPATCH.some((re) => re.test(line)));
}
