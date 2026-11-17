/**
 * Which tests in a Playwright JSON report passed only after an attempt FAILED.
 *
 * "More than one attempt" is not the same thing. In a `describe.serial` block,
 * one failure retries the whole block: the tests before it run again and pass
 * again, and the tests after it were skipped the first time. Counting those as
 * retry-passes reported ten "first-attempt failures" in production run
 * 44137617709 for a shard where exactly one test had failed, and sent the
 * triage looking for ten races. They are returned apart, as `rerun`, so the
 * report can say why they ran twice without calling them flaky.
 */

/** Attempt outcomes that are the test's own failure. `skipped`/`interrupted` are not. */
const FAILED = new Set(['failed', 'timedOut']);

/**
 * @param {{ suites?: unknown[] }} results Playwright's JSON reporter output.
 * @returns {{ flaky: Array<{ title: string, file: string, attempts: number, failed: number }>,
 *             rerun: Array<{ title: string, file: string, attempts: number }> }}
 */
export function retryPasses(results) {
  const flaky = [];
  const rerun = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const attempts = test.results?.length ?? 0;
        if (!(test.status === 'flaky' || (attempts > 1 && test.status === 'expected'))) continue;
        const failed = (test.results ?? []).filter((r) => FAILED.has(r.status)).length;
        const entry = { title: spec.title, file: spec.file ?? suite.file, attempts };
        if (failed > 0) flaky.push({ ...entry, failed });
        else rerun.push(entry);
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of results.suites ?? []) walk(suite);
  return { flaky, rerun };
}
