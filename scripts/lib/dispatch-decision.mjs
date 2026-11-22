/**
 * Dispatch a workflow exactly once, and prove the run exists. Pure decisions plus a loop over
 * injected I/O; scripts/dispatch-workflow.mjs supplies `gh api`, the tests supply fakes.
 *
 * Why: run 44966593936's "Start the deploy" ran `gh workflow run deploy.yml -f sha=...` and died
 * on `Get https://api.github.com/.../actions/workflows/deploy.yml: dial tcp ...: i/o timeout`.
 * Nothing said whether a deploy had started, so one was dispatched by hand. A blind retry has
 * the opposite failure: a POST that timed out may have landed, and a second one deploys twice.
 *
 * So the list of runs decides, never the POST's exit status: a run whose title is the one the
 * target's `run-name:` renders for these inputs, dispatched since this step began, IS the
 * dispatch. Look first; dispatch only when none is listed; after a transient POST error, poll a
 * whole window before dispatching again; two matching runs is ambiguous and refused; a 4xx is
 * fatal at once. Every count is bounded.
 */

export const LIMITS = Object.freeze({ dispatches: 3, pollsPerWindow: 12, pollSeconds: 5 });

const TRANSIENT_TEXT = /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|dial tcp|connection reset|socket hang up|TLS handshake|unexpected EOF|bad gateway|service unavailable/i;

/** 'transient' (retry after checking) or 'fatal' (stop). An unknown error is fatal: fail loudly. */
export function classify(error) {
  const status = error?.status;
  if (typeof status === 'number') return status >= 500 || status === 408 || status === 429 ? 'transient' : 'fatal';
  return TRANSIENT_TEXT.test(String(error?.message ?? '')) ? 'transient' : 'fatal';
}

/**
 * The title GitHub shows for a dispatch of this workflow: its `run-name:` with `${{ inputs.X }}`
 * or `${{ inputs.X || github.sha }}` filled in. Anything else cannot be predicted, so it throws.
 */
export function expectedTitle(workflowText, inputs) {
  const line = /^run-name:\s*(.+?)\s*$/m.exec(workflowText);
  if (!line) throw new Error('the workflow has no `run-name:`, so its dispatched run cannot be found by title');
  const template = line[1].replace(/^(['"])(.*)\1$/, '$2');
  return template.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (whole, expr) => {
    const m = /^inputs\.([A-Za-z0-9_-]+)(\s*\|\|\s*github\.sha)?$/.exec(expr);
    if (!m) throw new Error(`run-name expression \`${whole}\` cannot be predicted from the inputs`);
    const value = inputs[m[1]];
    if (typeof value !== 'string' || value === '') throw new Error(`run-name needs input ${m[1]}, which was not given`);
    return value;
  });
}

/** Dispatched runs of this title created at or after `since` (ISO 8601). */
export function matchingRuns(runs, { title, since }) {
  const from = Date.parse(since);
  if (Number.isNaN(from)) throw new Error(`since ${JSON.stringify(since)} is not a timestamp`);
  return runs.filter((r) => r.event === 'workflow_dispatch' && r.display_title === title && Date.parse(r.created_at) >= from);
}

/**
 * The next step, from what the last listing showed and what has been tried.
 * state: { dispatches, polls (since the last dispatch), cleanLists (successful empty listings
 *   since the last dispatch), lastError: { kind, message } | null }
 */
export function decide(matches, state, limits = LIMITS) {
  if (matches.length > 1) {
    return { do: 'refuse', reason: `${matches.length} runs match (${matches.map((r) => r.id).join(', ')}); refusing to guess which is this dispatch` };
  }
  if (matches.length === 1) return { do: 'done', id: matches[0].id, url: matches[0].html_url };
  if (state.lastError?.kind === 'fatal') return { do: 'fail', reason: `the API refused: ${state.lastError.message}` };
  if (state.dispatches === 0) return state.cleanLists > 0 ? { do: 'dispatch' } : { do: 'wait' };
  if (state.polls < limits.pollsPerWindow) return { do: 'wait' };
  if (state.lastError === null) {
    return { do: 'fail', reason: `dispatched, but no matching run appeared within ${limits.pollsPerWindow * limits.pollSeconds}s` };
  }
  if (state.cleanLists === 0) return { do: 'fail', reason: `the runs could not be listed after a failed dispatch (${state.lastError.message}); not retrying blind` };
  if (state.dispatches >= limits.dispatches) return { do: 'fail', reason: `${state.dispatches} dispatches failed, the last with ${state.lastError.message}` };
  return { do: 'dispatch' };
}

/**
 * io: { list(): Promise<run[]>, post(): Promise<void>, sleep(seconds), log(text) }
 * Resolves { id, url } of the run, or throws with the reason.
 */
export async function dispatchVerified(io, { title, since }, limits = LIMITS) {
  const state = { dispatches: 0, polls: 0, cleanLists: 0, lastError: null };
  // Listings before the first dispatch are bounded by the same window as the polls after it.
  for (let step = 0; step < (limits.dispatches + 1) * (limits.pollsPerWindow + 2); step += 1) {
    let matches = [];
    try {
      matches = matchingRuns(await io.list(), { title, since });
      if (matches.length === 0) state.cleanLists += 1;
    } catch (error) {
      if (classify(error) === 'fatal') throw new Error(`listing the runs failed: ${error.message}`);
      io.log(`listing the runs failed (${error.message}); will look again`);
    }
    const next = decide(matches, state, limits);
    if (next.do === 'done') return { id: next.id, url: next.url };
    if (next.do === 'refuse' || next.do === 'fail') throw new Error(next.reason);
    if (next.do === 'dispatch') {
      state.dispatches += 1;
      state.polls = 0;
      state.cleanLists = 0;
      try {
        await io.post();
        state.lastError = null;
        io.log(`dispatch ${state.dispatches} accepted; waiting for "${title}" to be listed`);
      } catch (error) {
        state.lastError = { kind: classify(error), message: String(error.message).split('\n')[0] };
        io.log(`dispatch ${state.dispatches} failed (${state.lastError.kind}: ${state.lastError.message}); the listing decides whether it landed`);
      }
      continue;
    }
    if (state.dispatches === 0 && state.polls >= limits.pollsPerWindow) throw new Error('the runs could not be listed before dispatching; not dispatching blind');
    state.polls += 1;
    await io.sleep(limits.pollSeconds);
  }
  throw new Error('gave up: the loop bound was reached');
}
