import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCES, fetchUrl } from './parse-rates.mjs';
import { PATHS, runUpdate } from './update-rates.mjs';

// In-memory ports, not mocks: the real parsers, guardrails and derivation run over the saved
// pages and the committed billing files; only the network and the disk are replaced.
const root = new URL('../../', import.meta.url);
const fixtures = Object.fromEntries(SOURCES.map((s) => [fetchUrl(s), readFileSync(new URL(`billing/fixtures/${s.id}.txt`, root), 'utf8')]));
const committed = Object.fromEntries(Object.values(PATHS).map((p) => [p, readFileSync(new URL(p, root), 'utf8')]));
const NOW = '2026-10-19T06:00:00.000Z';

function world({ edit = (url, body) => body, files = committed } = {}) {
  const written = {};
  return {
    written,
    ports: {
      fetchText: async (url) => {
        if (!(url in fixtures)) throw new Error(`no fixture for ${url}`);
        return edit(url, fixtures[url]);
      },
      readText: (p) => files[p],
      writeText: (p, text) => { written[p] = text; },
      now: NOW,
    },
  };
}

const turnUrl = fetchUrl(SOURCES.find((s) => s.id === 'cloudflare-turn'));
const setTurn = (to) => (url, body) => (url === turnUrl ? body.replace('$0.05/real-time', `$${to}/real-time`) : body);

test('(d) an unchanged run writes nothing', async () => {
  const w = world();
  const { wrote, log } = await runUpdate({ ...w.ports, ownerApproved: false });
  assert.deepEqual([wrote, log, w.written], [[], [], {}]);
});

test('a moved rate writes rates.json and the derived price, and logs both', async () => {
  const w = world({ edit: setTurn('0.06') });
  const { wrote, log } = await runUpdate({ ...w.ports, ownerApproved: false });
  assert.deepEqual(wrote, [PATHS.rates, PATHS.tiers]);
  assert.deepEqual(log, [
    'cloudflare.turn.usd_per_gb: 0.05 → 0.06 (https://developers.cloudflare.com/realtime/turn/)',
    'citadel-relay-overage: 15 → 18 (derived, 20.0%)',
  ]);
  const rates = JSON.parse(w.written[PATHS.rates]);
  assert.equal(rates.rates['cloudflare.turn.usd_per_gb'].fetched_at, NOW);
  assert.equal(rates.rates['cloudflare.r2.storage_usd_per_gb_month'].fetched_at, JSON.parse(committed[PATHS.rates]).rates['cloudflare.r2.storage_usd_per_gb_month'].fetched_at);
  const relay = JSON.parse(w.written[PATHS.tiers]).metered.find((m) => m.id === 'relay-overage');
  assert.equal(relay.prices[0].unit_amount, 18);
});

test('(a) one page that fails to fetch writes nothing', async () => {
  const w = world({ edit: (url, body) => { if (url === turnUrl) throw new Error('timeout'); return body; } });
  await assert.rejects(runUpdate({ ...w.ports, ownerApproved: true }), /fail closed, nothing written:\n {2}cloudflare-turn: timeout/);
  assert.deepEqual(w.written, {});
});

test('(a) one page whose figure is gone writes nothing, even with other changes', async () => {
  const gone = (url, body) => (url === turnUrl ? body.replace('$0.05/real-time GB', 'see your plan') : body.replace('$0.015 / GB-month', '$0.016 / GB-month'));
  const w = world({ edit: gone });
  await assert.rejects(runUpdate({ ...w.ports, ownerApproved: true }), /cloudflare.turn.usd_per_gb not found/);
  assert.deepEqual(w.written, {});
});

test('(b) a derived price moving past the cap is refused unless the owner approved it', async () => {
  const refused = world({ edit: setTurn('0.07') });
  await assert.rejects(runUpdate({ ...refused.ports, ownerApproved: false }), /citadel-relay-overage: 15 → 21 moves 40.0% > 25%/);
  assert.deepEqual(refused.written, {});
  const approved = world({ edit: setTurn('0.07') });
  const { wrote } = await runUpdate({ ...approved.ports, ownerApproved: true });
  assert.deepEqual(wrote, [PATHS.rates, PATHS.tiers]);
});

test('(c) a list seat price the new rates put under cost x multiplier is refused, approved or not', async () => {
  const doUrl = fetchUrl(SOURCES.find((s) => s.id === 'cloudflare-durable-objects'));
  const dear = (url, body) => (url === doUrl ? body.replace('+ $1.00 / million rows', '+ $5.00 / million rows') : body);
  const w = world({ edit: dear });
  await assert.rejects(runUpdate({ ...w.ports, ownerApproved: true }), /team\/month 600¢ < floor 1300¢/);
  assert.deepEqual(w.written, {});
});

test('a rate the record holds but no page provides any more is refused', async () => {
  const rates = JSON.parse(committed[PATHS.rates]);
  rates.rates['cloudflare.kv.reads_usd_per_million'] = { value: 0.5, unit: 'x', source: 'y', raw: 'z', fetched_at: NOW };
  const w = world({ files: { ...committed, [PATHS.rates]: JSON.stringify(rates) } });
  await assert.rejects(runUpdate({ ...w.ports, ownerApproved: true }), /cloudflare.kv.reads_usd_per_million: in rates.json but no source provides it/);
  assert.deepEqual(w.written, {});
});

test('ownerApproved and now are required', async () => {
  await assert.rejects(runUpdate({ ...world().ports }), /ownerApproved/);
  await assert.rejects(runUpdate({ ...world().ports, ownerApproved: false, now: undefined }), /ISO time/);
});
