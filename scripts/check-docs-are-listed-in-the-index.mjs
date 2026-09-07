#!/usr/bin/env node
/**
 * Every document in `docs/` must be reachable from `docs/README.md`.
 *
 * The index listed twenty files and omitted three, and the three it omitted
 * were the two people are told to read first -- `GATES.md`, whose own opening
 * line is "read this before writing a new guard", and `ROBUSTNESS.md`, the
 * findings record. Nothing linked to either from README.md, CLAUDE.md or the
 * index. A document nobody can find is a document nobody reads, and the cost
 * showed: guards were written that already existed, and findings re-reported
 * that were already recorded.
 *
 * `check-doc-file-refs.mjs` validates that a referenced path EXISTS. This is
 * the converse -- that an existing doc is referenced -- and the converse is the
 * direction that actually failed.
 */
import { readFileSync, readdirSync } from 'node:fs';

const INDEX = 'docs/README.md';
const index = readFileSync(INDEX, 'utf8');

const docs = readdirSync('docs')
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .sort();

if (docs.length < 5) {
  console.error(`\n  Found only ${docs.length} document(s) in docs/. The layout moved; fix this reader.\n`);
  process.exit(1);
}

const unlisted = docs.filter((f) => !index.includes(f));

if (unlisted.length > 0) {
  console.error(
    `\n  These documents exist in docs/ but nothing in ${INDEX} mentions them:\n\n` +
    unlisted.map((f) => `    docs/${f}`).join('\n') +
    `\n\n  Add a line to ${INDEX} saying what each is for. A document nobody can\n` +
    `  find is a document nobody reads -- which is how guards get written twice\n` +
    `  and findings get re-reported.\n`,
  );
  process.exit(1);
}

console.log(`docs index: all ${docs.length} document(s) in docs/ are listed in ${INDEX}.`);
