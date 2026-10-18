import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchBounded } from './fetch-rates.mjs';

// A real HTTP server on loopback, so the real fetch, abort and stream cap run.
const server = createServer((req, res) => {
  if (req.url === '/ok') return res.end('page');
  if (req.url === '/big') { res.write('x'.repeat(600)); res.write('x'.repeat(600)); return res.end(); }
  if (req.url === '/missing') { res.statusCode = 404; return res.end('no'); }
  if (req.url === '/stall') { res.write('partial'); return undefined; }
  return res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.closeAllConnections() || server.close());

const bounds = { timeoutMs: 500, maxBytes: 1000 };

test('a page under the bounds comes back whole', async () => {
  assert.equal(await fetchBounded(`${base}/ok`, bounds), 'page');
});

test('a page over the size cap is refused', async () => {
  await assert.rejects(fetchBounded(`${base}/big`, bounds), /larger than 1000 bytes/);
});

test('a non-2xx answer is refused', async () => {
  await assert.rejects(fetchBounded(`${base}/missing`, bounds), /HTTP 404/);
});

test('a stalled page is cut by the timeout', async () => {
  const t0 = Date.now();
  await assert.rejects(fetchBounded(`${base}/stall`, bounds), (e) => e.name === 'TimeoutError' || /abort|timeout/i.test(String(e)));
  assert.ok(Date.now() - t0 < 5000);
});

test('the bounds are required', async () => {
  await assert.rejects(fetchBounded(`${base}/ok`, {}), /needs timeoutMs and maxBytes/);
});
