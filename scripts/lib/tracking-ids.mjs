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

/** Where the exempt commits are listed, in every repository that runs this check. */
export const EXEMPTIONS_FILE = '.github/tracking-id-exemptions';

/**
 * The commits named in an exemptions file: one full 40-hex SHA per line and nothing else, so the
 * file cannot itself carry an identifier. Throws naming the line numbers (not their text) of any
 * other line. An empty file exempts nothing.
 */
export function parseExemptions(text) {
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text === '' ? [] : text.split('\n');
  const bad = lines.map((line, i) => ({ n: i + 1, line })).filter(({ line }) => !/^[0-9a-f]{40}$/.test(line));
  if (bad.length) {
    throw new Error(`${EXEMPTIONS_FILE}: line(s) ${bad.map((b) => b.n).join(', ')} are not a full 40-hex commit SHA`);
  }
  return new Set(lines);
}

/** One message per offending line, for [{ sha, where, text }] sources, skipping `exempt` commits. */
export function findings(sources, exempt) {
  return sources
    .filter(({ sha }) => sha === undefined || !exempt.has(sha))
    .flatMap(({ where, text }) => scan(text).map(({ n, line }) => `${where} line ${n}: ${line.trim()}`));
}

/** Split `git log --format=%H%x00%B%x1e` output into [{ where, text }] sources. */
export function parseLog(log) {
  return log
    .split('\x1e')
    .filter((record) => record.includes('\x00'))
    .map((record) => {
      const [raw, text] = record.split('\x00');
      const sha = raw.trim();
      return { sha, where: `commit ${sha.slice(0, 12)}`, text };
    });
}
