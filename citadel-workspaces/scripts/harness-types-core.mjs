/**
 * The type errors of the harness scenarios, counted per file and error code, against a baseline (pure).
 *
 * The polish-harness scenarios are .jsx: no typecheck ever read them. They construct real
 * components and app instances with hand-built props, so a required option added to one of them
 * broke the scenario silently (the Calendar's wallNow, three scenarios at once). Counted per
 * file and code, not per message: a message names whole types and changes with any unrelated edit
 * to them, a count changes only when a scenario gains or loses an error.
 */

const LINE = /^(.+?\.jsx)\(\d+,\d+\): error (TS\d+):/;

/** `{ "<file>": { "TS2741": 2, ... } }` from tsc's output, harness files only. */
export function countErrors(tscOutput) {
  const counts = {};
  for (const line of tscOutput.split('\n')) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    const [, file, code] = m;
    counts[file] ??= {};
    counts[file][code] = (counts[file][code] ?? 0) + 1;
  }
  return counts;
}

/** Where `found` has more errors than `baseline` (grew) and where fewer (shrank). */
export function compareToBaseline(found, baseline) {
  const grew = [];
  const shrank = [];
  for (const file of new Set([...Object.keys(found), ...Object.keys(baseline)])) {
    for (const code of new Set([...Object.keys(found[file] ?? {}), ...Object.keys(baseline[file] ?? {})])) {
      const now = found[file]?.[code] ?? 0;
      const was = baseline[file]?.[code] ?? 0;
      if (now > was) grew.push({ file, code, was, now });
      if (now < was) shrank.push({ file, code, was, now });
    }
  }
  return { grew, shrank };
}
