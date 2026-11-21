// Which lines of a commit message or pull request text carry an internal tracking identifier.
//
// Pure: the check beside this file feeds it git and the event payload, the tests feed it
// strings. A letter or dash before the prefix marks a longer public name (a signature scheme
// such as ML-DSA-65), which is not a tracking identifier.
export const PATTERNS = [
  /\b(?<![A-Za-z-])SA-[0-9]+\b/i,
  /\bGHSA-[0-9a-z]{4}-/i,
];

/** The 1-based number and text of each line of `text` that carries an identifier. */
export function scan(text) {
  return text
    .split(/\r?\n/)
    .map((line, i) => ({ n: i + 1, line }))
    .filter(({ line }) => PATTERNS.some((p) => p.test(line)));
}

/** One message per offending line, for [{ where, text }] sources. */
export function findings(sources) {
  return sources.flatMap(({ where, text }) => scan(text).map(({ n, line }) => `${where} line ${n}: ${line.trim()}`));
}

/** Split `git log --format=%H%x00%B%x1e` output into [{ where, text }] sources. */
export function parseLog(log) {
  return log
    .split('\x1e')
    .filter((record) => record.includes('\x00'))
    .map((record) => {
      const [sha, text] = record.split('\x00');
      return { where: `commit ${sha.trim().slice(0, 12)}`, text };
    });
}
