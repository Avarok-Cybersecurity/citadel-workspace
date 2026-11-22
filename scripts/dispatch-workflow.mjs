#!/usr/bin/env node
/**
 * Dispatch a workflow once, verified: exits 0 only when the run is listed, whether this call
 * dispatched it or an earlier, apparently failed, POST did. lib/dispatch-decision.mjs holds the
 * rules and the failure they answer (run 44966593936, an i/o timeout in `gh workflow run`).
 *
 *   node scripts/dispatch-workflow.mjs --repo OWNER/NAME --workflow deploy.yml --ref master \
 *     --since 2026-11-22T10:00:00Z --input sha=<40 hex>
 *
 * Every flag is required (--input at least once). --since is when the calling step began: a run
 * of the expected title created from then on is this dispatch. The expected title is rendered
 * from the target's own `run-name:` in .github/workflows/<file>, so the two cannot drift.
 * Auth: GH_TOKEN with actions: write.
 */
import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dispatchVerified, expectedTitle } from './lib/dispatch-decision.mjs';

const run = promisify(execFile);

function args(argv) {
  const out = { inputs: {} };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (flag === '--input') {
      const at = value.indexOf('=');
      if (at < 1) throw new Error(`--input ${value} is not name=value`);
      out.inputs[value.slice(0, at)] = value.slice(at + 1);
    } else if (['--repo', '--workflow', '--ref', '--since'].includes(flag)) {
      out[flag.slice(2)] = value;
    } else {
      throw new Error(`unknown flag ${flag}`);
    }
  }
  for (const key of ['repo', 'workflow', 'ref', 'since']) if (!out[key]) throw new Error(`--${key} is required`);
  if (Object.keys(out.inputs).length === 0) throw new Error('--input name=value is required');
  if (!/^[\w.-]+\/[\w.-]+$/.test(out.repo)) throw new Error(`--repo ${out.repo} is not OWNER/NAME`);
  if (!/^[\w.-]+\.ya?ml$/.test(out.workflow)) throw new Error(`--workflow ${out.workflow} is not a workflow file name`);
  if (Number.isNaN(Date.parse(out.since))) throw new Error(`--since ${out.since} is not a timestamp`);
  out.title = expectedTitle(readFileSync(join('.github', 'workflows', out.workflow), 'utf8'), out.inputs);
  return out;
}

/** gh api; an HTTP error carries its status so the decision can tell 4xx from 5xx. */
async function gh(apiArgs) {
  try {
    const { stdout } = await run('gh', ['api', '-H', 'Accept: application/vnd.github+json', ...apiArgs], { timeout: 30_000 });
    return stdout;
  } catch (error) {
    const text = `${error.stderr ?? ''} ${error.message ?? ''}`.trim();
    const status = /HTTP (\d{3})/.exec(text);
    const wrapped = new Error(error.killed ? `gh api timed out after 30s: ${text}` : text.split('\n')[0]);
    if (status) wrapped.status = Number(status[1]);
    throw wrapped;
  }
}

let opts;
try {
  opts = args(process.argv.slice(2));
} catch (error) {
  console.error(`dispatch-workflow: ${error.message}`);
  process.exit(2);
}
const { repo, workflow, ref, since, inputs, title } = opts;
const base = `repos/${repo}/actions/workflows/${workflow}`;

const io = {
  list: async () => JSON.parse(await gh([`${base}/runs?event=workflow_dispatch&created=${encodeURIComponent(`>=${since}`)}&per_page=100`])).workflow_runs,
  post: async () => {
    await gh(['-X', 'POST', `${base}/dispatches`, '-f', `ref=${ref}`, ...Object.entries(inputs).flatMap(([k, v]) => ['-f', `inputs[${k}]=${v}`])]);
  },
  sleep: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
  log: (text) => console.log(`  ${text}`),
};

try {
  const { id, url } = await dispatchVerified(io, { title, since });
  console.log(`${workflow} run ${id} is "${title}": ${url}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Dispatched [${title}](${url}) (run ${id}).\n`);
} catch (error) {
  console.error(`::error::${workflow} for "${title}" was not verified as dispatched: ${error.message}`);
  process.exit(1);
}
