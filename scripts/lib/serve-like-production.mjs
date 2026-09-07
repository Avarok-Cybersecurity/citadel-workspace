/**
 * Serve a built `dist/` the way the production container serves it: the same
 * Content-Security-Policy, and the same loopback-agent meta injection.
 *
 * Why this is not `npx serve dist`
 * --------------------------------
 * It was `npx serve dist` for months, and `npx serve` sends no CSP at all. So
 * every local proof ran under a policy strictly more permissive than the one
 * real users get, and a build whose registration path did
 *
 *     fetch('https://dns.google/resolve?name=<host>&type=A')
 *
 * passed locally every single time while being refused in production, where the
 * policy is `connect-src 'self' wss://local.<domain>:12345`. The bug was not
 * subtle and the proofs were not weak; they were run in an environment that
 * could not express the failure. A harness more permissive than production
 * cannot falsify a production-only defect, however many times it is run.
 *
 * The policy is READ FROM docker/ui/nginx.conf.template rather than copied, so
 * this cannot drift from what nginx actually sends. If the map block is
 * restructured, this throws instead of silently serving a stale policy -- an
 * outdated copy here would restore exactly the blind spot it exists to remove.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};

/** Extract the production CSP from the nginx template, substituting the origin. */
export function productionCsp(templatePath, loopbackOrigin) {
  const template = readFileSync(templatePath, 'utf8');
  const m = template.match(/map \$host \$csp \{\s*\n\s*default\s+"([^"]+)"/);
  if (!m) {
    throw new Error(
      `Could not read the CSP from ${templatePath}. The map $host $csp block has moved or ` +
      `changed shape. Fix this reader -- do NOT inline a copy of the policy, which is the ` +
      `drift this function exists to prevent.`,
    );
  }
  return m[1].replaceAll('${LOOPBACK_AGENT_ORIGIN}', loopbackOrigin);
}

/**
 * @param {{dist: string, port: number, cert: string, key: string,
 *          templatePath: string, loopbackOrigin: string}} opts
 */
export function serveLikeProduction(opts) {
  const csp = productionCsp(opts.templatePath, opts.loopbackOrigin);
  const root = resolve(opts.dist);

  const server = createServer(
    { cert: readFileSync(opts.cert), key: readFileSync(opts.key) },
    (req, res) => {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      // Contain traversal before touching the filesystem.
      const candidate = resolve(join(root, normalize(urlPath)));
      const isFile = candidate.startsWith(root + '/') || candidate === root;
      let file = isFile ? candidate : root;

      let body;
      try {
        body = readFileSync(file);
      } catch {
        file = join(root, 'index.html'); // SPA fallback
        body = readFileSync(file);
      }

      const ext = extname(file);
      if (ext === '.html') {
        // The nginx sub_filter, byte for byte.
        body = Buffer.from(
          body.toString('utf8').replace(
            'name="citadel-loopback-agent" content=""',
            `name="citadel-loopback-agent" content="${opts.loopbackOrigin}"`,
          ),
        );
      }
      res.writeHead(200, {
        'Content-Type': TYPES[ext] ?? 'application/octet-stream',
        'Content-Security-Policy': csp,
        'Content-Length': body.length,
      });
      res.end(body);
    },
  );
  server.listen(opts.port);
  return server;
}
