#!/usr/bin/env node
/**
 * The hosted UI's one off-origin socket is wired end to end, or not claimed.
 *
 * A page served from work.example.com must open a socket to the agent on the
 * VISITOR'S OWN machine — `wss://local.example.com:12345`, a public name whose
 * A record is 127.0.0.1. That needs three things to agree, in three files:
 *
 *   1. `index.html` carries `<meta name="citadel-loopback-agent" content="">`,
 *      which the app reads to decide what to dial.
 *   2. `nginx.conf.template` fills that meta in AND names the same origin in
 *      `connect-src`, because a page that dials what its own policy forbids
 *      fails with a console error and no other symptom.
 *   3. `Dockerfile` lists the variable in `NGINX_ENVSUBST_FILTER`, or nginx
 *      serves the literal `${LOOPBACK_AGENT_ORIGIN}` to browsers — the filter
 *      is an allowlist, and a variable missing from it is not substituted.
 *
 * WRITTEN BECAUSE IT HAPPENED, and because of how it was found. `index.html`
 * described this mechanism in a comment — "filled in by the hosting nginx when
 * the operator publishes a loopback agent origin (LOOPBACK_AGENT_ORIGIN)" — and
 * that string appeared EXACTLY ONCE in the entire repository: in the comment.
 * No template substituted it, no CSP admitted it, no entrypoint validated it.
 *
 * The live site worked anyway, because it was running an image built by hand
 * from a branch that was never merged. So the tree could not build an image
 * that served its own production deployment: anything published from it would
 * have shipped an empty meta tag and a `connect-src 'self'` that forbids the
 * agent, which is a silent and total outage for every user — and the page would
 * have looked fine until someone tried to sign in.
 *
 * A feature wired from one end is this repository's most productive defect
 * class. This one was wired from zero ends and documented as though it were
 * finished.
 */
import { readFileSync } from 'node:fs';

const VAR = 'LOOPBACK_AGENT_ORIGIN';
const META = 'citadel-loopback-agent';

const files = {
  index: 'citadel-workspaces/index.html',
  nginx: 'docker/ui/nginx.conf.template',
  dockerfile: 'docker/ui/Dockerfile',
  validator: 'docker/ui/16-validate-runtime-vars.sh',
};

const problems = [];
const read = (key) => {
  try {
    return readFileSync(files[key], 'utf8');
  } catch (error) {
    problems.push(`${files[key]} could not be read: ${String(error).split('\n')[0]}`);
    return '';
  }
};

const index = read('index');
const nginx = read('nginx');
const dockerfile = read('dockerfile');
const validator = read('validator');

// 1. The page has somewhere to put the answer.
if (!new RegExp(`name="${META}"`).test(index)) {
  problems.push(`${files.index}: no <meta name="${META}"> for the agent origin to be written into.`);
}

// 2a. nginx fills it in. The sub_filter must quote the meta the page actually
// ships, so a change to either side that leaves them unable to match is caught
// here rather than by a user whose agent is never dialled.
const sub = new RegExp(`sub_filter\\s+'name="${META}" content=""'`).test(nginx);
if (!sub) {
  problems.push(
    `${files.nginx}: no sub_filter fills <meta name="${META}">, so a hosted deployment ` +
    `serves the page with an empty agent origin and the app falls back to same-origin /ws — ` +
    `where, on a hosted host, no agent is listening.`);
}

// 2b. and the policy admits it.
if (!nginx.includes(`connect-src 'self' \${${VAR}}`)) {
  problems.push(
    `${files.nginx}: connect-src does not admit \${${VAR}}. The page would dial an origin ` +
    `its own Content-Security-Policy forbids, which fails with nothing but a console error.`);
}

// 3. envsubst is an allowlist; absence means the literal is served.
const filter = /NGINX_ENVSUBST_FILTER=\^\(([^)]*)\)\$/.exec(dockerfile);
if (!filter) {
  problems.push(`${files.dockerfile}: no NGINX_ENVSUBST_FILTER found — this check cannot tell what is substituted.`);
} else if (!filter[1].split('|').includes(VAR)) {
  problems.push(
    `${files.dockerfile}: NGINX_ENVSUBST_FILTER does not list ${VAR}, so it is never substituted ` +
    `and nginx serves the literal \${${VAR}} to browsers. Filter is: ${filter[1]}`);
}

// 4. and an operator's typo fails loudly at start-up rather than quietly in a policy.
// A WORD BOUNDARY, not `includes`. A substring match is satisfied by a
// DIFFERENT variable that merely starts with this name -- caught by the
// negative control for this very line, which renamed the variable to
// `LOOPBACK_AGENT_ORIGINX` throughout the validator and left the gate green.
if (!new RegExp(`\\b${VAR}\\b`).test(validator)) {
  problems.push(
    `${files.validator}: ${VAR} is not validated. It lands in a CSP directive and an HTML ` +
    `attribute, where a quote or a semicolon does not fail — it silently widens or breaks one.`);
}

if (problems.length) {
  console.error('The loopback agent origin is not wired end to end:\n');
  for (const p of problems) console.error('  - ' + p);
  console.error(
    '\nEither wire it in every file above, or stop claiming it: an operator who sets\n' +
    `${VAR} and gets a page that ignores it has no way to tell.`);
  process.exit(1);
}
console.log(`The loopback agent origin is wired: meta, sub_filter, connect-src, envsubst filter and validation all name ${VAR}.`);
