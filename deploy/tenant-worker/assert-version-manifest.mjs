#!/usr/bin/env node
/**
 * The bundle a deploy ships carries this release's kill switch: dist/version.json's `minSeq`
 * is the committed MIN_BUILD_SEQ (citadel-workspaces/src/lib/pwa/min-build-seq.ts), and the
 * build's own `seq` is not below it (it would reload itself for ever). Without it, pages
 * running an older build stay open against a release they cannot work with.
 *
 * It also names the agent release the build ships with (`agent`), the agent crate's version.
 *
 * Usage: assert-version-manifest.mjs <ui-dir>   (build-ui.sh runs it after `vite build`)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ui = process.argv[2];
if (!ui) { console.error('usage: assert-version-manifest.mjs <ui-dir>'); process.exit(2); }
const fail = (message) => { console.error(`assert-version-manifest: ${message}`); process.exit(1); };

const source = readFileSync(join(ui, 'src/lib/pwa/min-build-seq.ts'), 'utf8');
const declared = /export const MIN_BUILD_SEQ: number = (\d+);/.exec(source);
if (!declared) fail('min-build-seq.ts declares no MIN_BUILD_SEQ');
const expected = Number(declared[1]);

let manifest;
try { manifest = JSON.parse(readFileSync(join(ui, 'dist/version.json'), 'utf8')); } catch (error) { fail(`dist/version.json: ${error.message}`); }
if (manifest.minSeq !== expected) fail(`dist/version.json minSeq is ${manifest.minSeq}, not this release's ${expected}`);
if (!Number.isSafeInteger(manifest.seq) || manifest.seq < expected) fail(`dist/version.json seq ${manifest.seq} is below its own minSeq ${expected}`);
// The agent release the banner names (agent-update/released-agent.ts): the agent crate's version.
const toml = readFileSync(join(ui, '../citadel-workspace-internal-service/Cargo.toml'), 'utf8');
const crate = /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(toml);
if (!crate) fail('citadel-workspace-internal-service/Cargo.toml has no [package] version');
if (manifest.agent !== crate[1]) fail(`dist/version.json agent is ${manifest.agent}, not the agent crate's ${crate[1]}`);
console.log(`assert-version-manifest: minSeq ${expected}, seq ${manifest.seq}, agent ${manifest.agent}`);
