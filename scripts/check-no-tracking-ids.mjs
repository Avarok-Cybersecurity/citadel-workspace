#!/usr/bin/env node
/**
 * Keep internal tracking identifiers out of public history.
 *
 * Reads the message of every commit the branch adds (merge-base..HEAD, so commits already on
 * the base branch are never judged) and, in CI, the pull request's title and body, passed in
 * through PR_TITLE and PR_BODY, and fails naming each line that carries one. A commit whose
 * full SHA is listed in `.github/tracking-id-exemptions` is not judged; the list holds SHAs
 * only and refuses any other line.
 *
 * The base is the pull request's (GITHUB_BASE_REF) in CI, and the remote's default branch, as
 * the clone records it, anywhere else. Run from the repository root:
 * `node scripts/check-no-tracking-ids.mjs`.
 */
import { git } from './lib/overlay.mjs';
import { remoteDefault } from './lib/changed-paths.mjs';
import { readFileSync } from 'node:fs';
import { EXEMPTIONS_FILE, findings, parseExemptions, parseLog } from './lib/tracking-ids.mjs';

const repo = '.';
const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : remoteDefault(repo, 'origin');
const mergeBase = git(repo, 'merge-base', 'HEAD', base);
const sources = parseLog(git(repo, 'log', '--format=%H%x00%B%x1e', `${mergeBase}..HEAD`));
for (const name of ['TITLE', 'BODY']) {
  const text = process.env[`PR_${name}`];
  if (text !== undefined) sources.push({ where: `pull request ${name.toLowerCase()}`, text });
}

const exempt = parseExemptions(readFileSync(EXEMPTIONS_FILE, 'utf8'));
const found = findings(sources, exempt);
if (found.length) {
  for (const f of found) console.error(`::error::${f}`);
  console.error('\n  Keep internal tracking identifiers out of public history: reword the commit message (or the pull request text) without them.\n');
  process.exit(1);
}
console.log(`no tracking identifier in ${sources.length} commit message(s) and pull request text(s) since ${base}`);
