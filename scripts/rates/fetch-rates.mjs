#!/usr/bin/env node
/**
 * Bounded fetches of the rate pages (scripts/rates/parse-rates.mjs SOURCES). A fetch that stalls
 * is cut by its timeout and a page larger than the cap is refused mid-stream, so a hung or
 * hostile server cannot hold the weekly run or fill its memory.
 *
 *   node scripts/rates/fetch-rates.mjs --fixtures billing/fixtures   # rewrite the parser fixtures
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCES, fetchUrl, trimForFixture } from './parse-rates.mjs';

/** Per page: the slowest observed is under 2 s; 30 s bounds a hang, not a slow page. */
export const FETCH_TIMEOUT_MS = 30_000;
/** stripe.com/pricing is ~1 MB of HTML; 5 MB refuses anything far outside that. */
export const MAX_PAGE_BYTES = 5_000_000;
/** Characters kept either side of each parser match in a fixture. */
const FIXTURE_MARGIN = 240;

/** The body of `url` as text, or a throw: non-2xx, timeout, or more than `maxBytes`. */
export async function fetchBounded(url, { timeoutMs, maxBytes }) {
  if (!Number.isInteger(timeoutMs) || !Number.isInteger(maxBytes)) throw new Error('fetchBounded needs timeoutMs and maxBytes');
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: { 'User-Agent': 'citadel-rates-agent (+https://github.com/Avarok-Cybersecurity/citadel-workspace)' },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    // Throwing out of the for-await returns the iterator, which cancels the stream.
    if (size > maxBytes) throw new Error(`${url}: larger than ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The production fetch port: the bounds above, no other choices. */
export const fetchText = (url) => fetchBounded(url, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES });

async function writeFixtures(dir) {
  mkdirSync(dir, { recursive: true });
  for (const source of SOURCES) {
    const trimmed = trimForFixture(source, await fetchText(fetchUrl(source)), FIXTURE_MARGIN);
    writeFileSync(join(dir, `${source.id}.txt`), trimmed);
    console.log(`${source.id}.txt ${trimmed.length} chars`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--fixtures');
  if (i < 0 || !process.argv[i + 1]) {
    console.error('usage: fetch-rates.mjs --fixtures <dir>');
    process.exit(2);
  }
  await writeFixtures(process.argv[i + 1]);
}
