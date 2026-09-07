import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
const cert = { cert: readFileSync('/tmp/work.test.crt'), key: readFileSync('/tmp/work.test.key') };
for (const [listen, upstream] of [[8445, 8097], [8446, 8096]]) {
  createServer(cert, (req, res) => {
    const up = request({ host: '127.0.0.1', port: upstream, path: req.url, method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${upstream}` } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
  }).listen(listen, () => console.log(`https://work.test:${listen} -> :${upstream}`));
}
