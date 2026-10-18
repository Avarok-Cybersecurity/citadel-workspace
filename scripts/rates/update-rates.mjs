#!/usr/bin/env node
/**
 * The rates agent: fetch every rate page, parse it, run the guardrails, then write
 * billing/rates.json and the DERIVED unit_amounts in billing/tiers.json -- or nothing.
 *
 *   node scripts/rates/update-rates.mjs                   # the weekly run (.github/workflows/rates.yml)
 *   node scripts/rates/update-rates.mjs --owner-approved  # lets a derived price move past the cap
 *
 * Prints the change log ("id: old → new (source)") on stdout; exits non-zero, having written
 * nothing, when any page fails or any guardrail refuses (scripts/rates/plan-update.mjs).
 * No model, no judgement: regexes over the providers' own pages.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCES, fetchUrl } from './parse-rates.mjs';
import { collectRates, planUpdate } from './plan-update.mjs';

export const PATHS = {
  rates: 'billing/rates.json',
  model: 'billing/pricing-model.json',
  tiers: 'billing/tiers.json',
};

const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

/**
 * One run against the given ports: fetchText(url) -> text, readText(path), writeText(path, text).
 * Returns { log, wrote } -- `wrote` lists the paths written (none on an unchanged run).
 */
export async function runUpdate({ fetchText, readText, writeText, ownerApproved, now }) {
  const results = await Promise.all(SOURCES.map(async (source) => {
    try {
      return { source, body: await fetchText(fetchUrl(source)) };
    } catch (error) {
      return { source, error };
    }
  }));
  const fetched = collectRates(SOURCES, results);
  const plan = planUpdate({
    oldRates: JSON.parse(readText(PATHS.rates)),
    fetched,
    model: JSON.parse(readText(PATHS.model)),
    tiers: JSON.parse(readText(PATHS.tiers)),
    ownerApproved,
    now,
  });
  const wrote = [];
  if (plan.rates) { writeText(PATHS.rates, json(plan.rates)); wrote.push(PATHS.rates); }
  if (plan.tiers) { writeText(PATHS.tiers, json(plan.tiers)); wrote.push(PATHS.tiers); }
  return { log: plan.log, explanations: plan.explanations, wrote };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const flags = process.argv.slice(2);
  const unknown = flags.filter((f) => f !== '--owner-approved');
  if (unknown.length) {
    console.error(`unknown argument(s): ${unknown.join(' ')}\nusage: update-rates.mjs [--owner-approved]`);
    process.exit(2);
  }
  const { fetchText } = await import('./fetch-rates.mjs');
  try {
    const { log, explanations, wrote } = await runUpdate({
      fetchText,
      readText: (p) => readFileSync(join(root, p), 'utf8'),
      writeText: (p, text) => writeFileSync(join(root, p), text),
      ownerApproved: flags.includes('--owner-approved'),
      now: new Date().toISOString(),
    });
    if (!wrote.length) {
      console.log('No change: every rate and derived price is as recorded.');
    } else {
      console.log(`## Rate changes\n\n${log.map((l) => `- ${l}`).join('\n')}\n\nWrote ${wrote.join(', ')}.`);
      console.log(`\n<details><summary>Derivation</summary>\n\n${explanations.map((l) => `- ${l}`).join('\n')}\n\n</details>`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
