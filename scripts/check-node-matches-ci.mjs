#!/usr/bin/env node
/**
 * The Node running the gates is the major CI runs them on.
 *
 * A developer's default `node` here was 18 while CI pins 20, and a gate that imports an API
 * from a newer Node (globSync, Node 22) passes on one and throws on the other. The version is
 * DERIVED from the `actions/setup-node` steps of the jobs that run the gates, in both repos'
 * workflows -- not written here -- and where CI disagrees with itself that is printed rather
 * than averaged away.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivedChecks } from './lib/preflight-plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let node;
try {
  ({ node } = derivedChecks(ROOT));
} catch (error) {
  console.error(`FAIL: cannot derive CI's Node version: ${error.message}`);
  process.exit(1);
}

const local = Number.parseInt(process.versions.node, 10);
const coverage = [...node.covered].map(([major, n]) => `Node ${major}: ${n} gate(s)`).join(', ');

if (node.elsewhere.length > 0) {
  console.log(`CI is inconsistent: its gate jobs pin ${coverage}. Required here: ${node.major}, the major covering the most gates.`);
  console.log(`These run in CI ONLY under another major, so a local run cannot match them exactly:`);
  for (const { label, majors } of node.elsewhere) console.log(`  - ${label} (CI: Node ${majors.join(', ')})`);
}

if (local !== node.major) {
  console.error(`FAIL: this is Node ${process.versions.node}; CI runs the gates on Node ${node.major} (${coverage}).`);
  console.error(`  fix: nvm install ${node.major} && nvm use ${node.major}   (or put a Node ${node.major} first on PATH)`);
  process.exit(1);
}
console.log(`Node ${process.versions.node} matches CI's Node ${node.major} (${coverage}).`);
