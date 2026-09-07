// An https front for the production UI container, the way nginx fronts it on
// avarok2: TLS terminated here, plain http to the container, and a NON-loopback
// server name so the page takes the loopback-agent meta branch rather than the
// same-origin /ws proxy.
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
createServer({ cert: readFileSync('/tmp/work.test.crt'), key: readFileSync('/tmp/work.test.key') },
  (req, res) => {
    const up = request({ host: '127.0.0.1', port: 8099, path: req.url, method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:8099' } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
  }).listen(8443, () => console.log('https://work.test:8443 -> container :8099'));
