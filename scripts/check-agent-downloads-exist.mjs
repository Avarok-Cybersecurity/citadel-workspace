#!/usr/bin/env node
/**
 * Every agent download the UI offers is an asset the release actually builds.
 *
 * The hosted page is where a new user starts: it detects their platform and
 * hands them a link to
 * `releases/latest/download/citadel-agent-<platform>.tar.gz`. GitHub resolves
 * that against the newest release, so the NAME is the entire contract. Rename
 * an asset in the release matrix, or a value in `AGENT_ASSETS`, and the button
 * 404s — for every new user, on the first step of joining, with nothing in the
 * app able to tell them why.
 *
 * Two files, one rule, and nothing was holding them together. They agree today;
 * this is what keeps them agreeing. The same shape has cost this repository a
 * fix applied in one of two places more often than any other defect.
 *
 * The comment above `AgentPlatform` already says "matching the release
 * workflow's matrix" — a claim, in prose, that nothing verified.
 *
 * WHAT THIS DOES NOT CHECK: that a release exists, or that its assets uploaded.
 * `scripts/smoke-agent.sh` runs against each packaged archive in the release
 * workflow and is what proves an asset is usable; this only pins the names to
 * each other.
 */
import { readFileSync, existsSync } from 'node:fs';

const WORKFLOW = '.github/workflows/release-agent.yml';
// The UI half lives in the submodule; both paths are tried so this runs from
// the parent and from a UI checkout. Finding NEITHER is a failure, never a skip.
const UI_PATHS = ['citadel-workspaces/src/lib/agent-download.ts', 'src/lib/agent-download.ts'];

const problems = [];

const uiPath = UI_PATHS.find((p) => existsSync(p));
if (!uiPath) {
  console.error(`None of ${UI_PATHS.join(', ')} exists — the download list could not be read.`);
  process.exit(1);
}
if (!existsSync(WORKFLOW)) {
  console.error(`${WORKFLOW} does not exist — the release matrix could not be read.`);
  process.exit(1);
}

const offered = new Set(
  [...readFileSync(uiPath, 'utf8').matchAll(/'(citadel-agent-[^']+)'/g)].map((m) => m[1]),
);
const built = new Set(
  [...readFileSync(WORKFLOW, 'utf8').matchAll(/asset:\s*(citadel-agent-\S+)/g)].map((m) => m[1]),
);

if (offered.size === 0) problems.push(`${uiPath}: no citadel-agent-* asset names found — this check verified nothing.`);
if (built.size === 0) problems.push(`${WORKFLOW}: no \`asset:\` entries found — this check verified nothing.`);

for (const name of offered) {
  if (!built.has(name)) {
    problems.push(`${uiPath} offers "${name}", which ${WORKFLOW} never builds. That download 404s.`);
  }
}
for (const name of built) {
  if (!offered.has(name)) {
    problems.push(`${WORKFLOW} builds "${name}", which the UI never offers. Nobody can reach it.`);
  }
}

if (problems.length) {
  console.error('The agent downloads the UI offers and the release builds disagree:\n');
  for (const p of problems) console.error('  - ' + p);
  console.error('\nThese names are the whole contract: GitHub resolves them under releases/latest.');
  process.exit(1);
}
console.log(`Agent downloads OK: ${offered.size} asset name(s) offered by the UI, all built by the release.`);
