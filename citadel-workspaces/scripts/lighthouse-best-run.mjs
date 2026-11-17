/**
 * Which Lighthouse run the performance floor is judged on: the best-scoring one.
 *
 * Returns an index into `runs` itself, or -1 when no run produced a performance
 * score. A run can lack one (Lighthouse's NO_LCP when it could not find the
 * largest paint), and the index must still point at the run that scored, not
 * at a position in a list with the unscored runs taken out: that mismatch once
 * judged the floor on the one run that had no score, and failed a build whose
 * other samples were 68 and 74 against a floor of 40.
 *
 * @param {ReadonlyArray<{ categories?: { performance?: { score?: number | null } } }>} runs
 * @returns {number}
 */
export function bestPerformanceRun(runs) {
  let best = -1;
  runs.forEach((lhr, index) => {
    const score = lhr.categories?.performance?.score;
    if (typeof score !== 'number') return;
    if (best === -1 || score > runs[best].categories.performance.score) best = index;
  });
  return best;
}
