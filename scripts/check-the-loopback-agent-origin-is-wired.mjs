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
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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

// 5. And it RENDERS. Every check above asks whether a name is present; this one
// asks what an operator actually gets, which is the only thing that matters and
// is where a stray quote or an unbalanced brace would show up. envsubst's
// allowlist is mirrored here rather than assumed: a variable outside it is left
// as a literal, and serving a literal `${...}` to a browser is one of the
// failure modes this gate exists for.
const ALLOWED = filter ? filter[1].split('|') : [];
const render = (env) =>
  nginx.replace(/\$\{([A-Z_]+)\}/g, (whole, name) =>
    (ALLOWED.includes(name) ? (env[name] ?? '') : whole));

const SAMPLE = 'wss://local.example.com:12345';
const hosted = render({
  AGENT_UPSTREAM: '127.0.0.1:12345', WS_PROXY_ENABLED: '0', LISTEN_ADDR: '0.0.0.0',
  [VAR]: SAMPLE,
});
const compose = render({
  AGENT_UPSTREAM: 'internal-service:12345', WS_PROXY_ENABLED: '1', LISTEN_ADDR: '0.0.0.0',
  [VAR]: '',
});

const connectSrc = (conf) => (/^\s*default\s+"([^"]+)";/m.exec(conf)?.[1] ?? '').match(/connect-src[^;]*/)?.[0] ?? '';
const metaFilter = (conf) => /sub_filter\s+'name="citadel-loopback-agent"[^\n]*/.exec(conf)?.[0] ?? '';

if (!connectSrc(hosted).includes(SAMPLE)) {
  problems.push(`rendered with ${VAR}=${SAMPLE}, connect-src does not contain it: "${connectSrc(hosted)}"`);
}
if (!metaFilter(hosted).includes(SAMPLE)) {
  problems.push(`rendered with ${VAR}=${SAMPLE}, the meta sub_filter does not write it in.`);
}
if (connectSrc(compose).includes('://')) {
  problems.push(`rendered with ${VAR} empty, connect-src still names an origin: "${connectSrc(compose)}"`);
}
for (const [label, conf] of [['hosted', hosted], ['compose', compose]]) {
  const leftover = [...new Set((conf.match(/\$\{[A-Z_]+\}/g) ?? []))].filter((v) =>
    ALLOWED.includes(v.slice(2, -1)));
  if (leftover.length) {
    problems.push(`the ${label} render leaves ${leftover.join(', ')} unsubstituted; nginx would serve that literal.`);
  }
}

// 6. The hosted deployment actually PASSES it in.
//
// Everything above makes the image capable of serving a loopback origin. The
// image defaults it to EMPTY, correctly -- a local deployment reaches its agent
// through the same-origin proxy and needs none. A hosted one has that proxy
// off, deliberately, so an empty value there is not a default but an outage:
// the page loads, looks right, and can open no socket at all.
const COMPOSE = 'docker-compose.production.yml';
if (!existsSync(COMPOSE)) {
  problems.push(`${COMPOSE} does not exist — the hosted deployment could not be checked.`);
} else {
  const compose = readFileSync(COMPOSE, 'utf8');
  const ui = compose.slice(compose.indexOf('\n  ui:'));
  const uiBlock = ui.slice(0, ui.indexOf('\n  cloudflared:') + 1 || undefined);
  if (!/\n  ui:/.test(compose)) {
    problems.push(`${COMPOSE}: no \`ui:\` service — this check has lost its subject.`);
  } else if (!new RegExp(`\\b${VAR}\\b`).test(uiBlock)) {
    problems.push(
      `${COMPOSE}: the \`ui\` service never mentions ${VAR}, so a deploy from this file serves ` +
      `the page with an empty agent origin and a policy that forbids the agent. Every visitor gets ` +
      `a page that loads and cannot connect.`);
  }
}

// 6b. And the DEPLOY refuses to ship a hosted UI without one.
//
// The compose file only passes the variable through; it cannot require it,
// because `${VAR:?}` makes every `docker compose config` on the file fail --
// including the `--services` metadata read deploy.sh itself performs. (That was
// tried, for one commit, and the "Deploy service selection covers every compose
// shape" gate caught it.) So the requirement lives in deploy.sh, which knows
// whether the deployment it is about to perform actually serves a UI.
if (!existsSync('deploy.sh')) {
  problems.push('deploy.sh does not exist — the deploy-time requirement could not be checked.');
} else if (!new RegExp(`\\b${VAR}\\b`).test(readFileSync('deploy.sh', 'utf8'))) {
  problems.push(
    `deploy.sh never mentions ${VAR}, so nothing stops a hosted deploy going out with an empty ` +
    `one. The compose file cannot enforce it: making the variable required there breaks ` +
    `\`docker compose config --services\`, which deploy.sh uses to decide what to deploy.`);
}

// 7. And the container REFUSES what the page will ignore.
//
// The page has its own shape check -- LOOPBACK_ORIGIN_SHAPE in
// resolve-url.ts -- and an origin it rejects is not an error there: it falls
// through to same-origin `/ws`, which a hosted deployment disables. So a
// validator laxer than the page produces a container that starts, reports "ok",
// substitutes the value into the CSP and the meta tag, and hands every visitor
// a dead socket. Measured: `wss://Local.Avarok.net:12345` and
// `wss://local_agent.example:12345` were accepted here and ignored there.
//
// Differential, not duplicated: the page's regex is EXTRACTED and both are run
// against the same probes, so a future change to either side that makes them
// disagree fails here rather than in a browser.
const UI_SHAPE_PATHS = [
  'citadel-workspaces/src/lib/websocket-service/resolve-url.ts',
  'src/lib/websocket-service/resolve-url.ts',
];
const shapePath = UI_SHAPE_PATHS.find((p) => existsSync(p));
if (!shapePath) {
  problems.push(`none of ${UI_SHAPE_PATHS.join(', ')} exists — the page's shape check could not be read.`);
} else {
  const literal = /LOOPBACK_ORIGIN_SHAPE:\s*RegExp\s*=\s*\/(.+?)\/;/.exec(readFileSync(shapePath, 'utf8'));
  if (!literal) {
    problems.push(`${shapePath}: LOOPBACK_ORIGIN_SHAPE not found — this comparison verified nothing.`);
  } else {
    const pageShape = new RegExp(literal[1]);
    const PROBES = [
      'wss://local.example.com:12345',
      'wss://Local.Example.com:12345',
      'wss://local_agent.example:12345',
      'wss://local.example.com:12345/path',
      'ws://local.example.com:12345',
      'wss://local.example.com',
    ];
    for (const probe of PROBES) {
      const pageAccepts = pageShape.test(probe);
      const containerAccepts = spawnSync('sh', [files.validator], {
        env: {
          ...process.env,
          LOOPBACK_AGENT_ORIGIN: probe,
          AGENT_UPSTREAM: '127.0.0.1:12345',
          WS_PROXY_ENABLED: '0',
          LISTEN_ADDR: '0.0.0.0',
        },
        encoding: 'utf8',
      }).status === 0;
      if (pageAccepts !== containerAccepts) {
        problems.push(
          `"${probe}": ${files.validator} ${containerAccepts ? 'accepts' : 'rejects'} it but the page ` +
          `${pageAccepts ? 'accepts' : 'IGNORES'} it. A value the container admits and the page ignores ` +
          `is a dead socket for every visitor, with the container reporting "ok".`);
      }
    }
  }
}

if (problems.length) {
  console.error('The loopback agent origin is not wired end to end:\n');
  for (const p of problems) console.error('  - ' + p);
  console.error(
    '\nEither wire it in every file above, or stop claiming it: an operator who sets\n' +
    `${VAR} and gets a page that ignores it has no way to tell.`);
  process.exit(1);
}
console.log(
  `The loopback agent origin is wired: meta, sub_filter, connect-src, envsubst filter and `
  + `validation all name ${VAR}; the template renders it into both the policy and the page; `
  + `and the container and the page agree on which origins are acceptable.`,
);
