import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { SOURCES, fetchUrl, parseSource, textOf, trimForFixture } from './parse-rates.mjs';

const fixturePath = (id) => new URL(`../../billing/fixtures/${id}.txt`, import.meta.url);
const fixture = (id) => readFileSync(fixturePath(id), 'utf8');
const source = (id) => SOURCES.find((s) => s.id === id);

const VERIFIED_2026_10_18 = {
  'cloudflare.do.rows_written_usd_per_million': 1.0,
  'cloudflare.do.requests_usd_per_million': 0.15,
  'cloudflare.do.ws_messages_per_request': 20,
  'cloudflare.do.sqlite_usd_per_gb_month': 0.2,
  'cloudflare.do.duration_usd_per_million_gbs': 12.5,
  'cloudflare.r2.storage_usd_per_gb_month': 0.015,
  'cloudflare.turn.usd_per_gb': 0.05,
  'cloudflare.email.usd_per_thousand': 0.35,
  'stripe.card.percent': 2.9,
  'stripe.card.fixed_usd': 0.3,
  'stripe.billing.percent': 0.7,
  'stripe.tax.percent': 0.5,
};

test('every fixture parses to the verified figures', () => {
  const got = {};
  for (const s of SOURCES) for (const [id, { value }] of Object.entries(parseSource(s, fixture(s.id)))) got[id] = value;
  assert.deepEqual(got, VERIFIED_2026_10_18);
});

test('every fixture is under 100 KB', () => {
  for (const s of SOURCES) assert.ok(statSync(fixturePath(s.id)).size <= 100_000, s.id);
});

test('raw is the exact fragment matched', () => {
  assert.equal(parseSource(source('stripe-payments'), fixture('stripe-payments'))['stripe.card.fixed_usd'].raw,
    'online payments. 2.9% + 30¢ per successful transaction for domestic cards');
  assert.equal(parseSource(source('cloudflare-turn'), fixture('cloudflare-turn'))['cloudflare.turn.usd_per_gb'].raw, 'costs $0.05/real-time GB outbound');
});

test('a changed figure parses to the changed figure', () => {
  const turn = fixture('cloudflare-turn').replace('$0.05/real-time', '$0.07/real-time');
  assert.equal(parseSource(source('cloudflare-turn'), turn)['cloudflare.turn.usd_per_gb'].value, 0.07);
  const card = fixture('stripe-payments').replace('online payments. 2.9% + 30¢', 'online payments. 3.1% + 35¢');
  const parsed = parseSource(source('stripe-payments'), card);
  assert.deepEqual([parsed['stripe.card.percent'].value, parsed['stripe.card.fixed_usd'].value], [3.1, 0.35]);
});

test('a removed figure fails closed', () => {
  const gone = fixture('cloudflare-durable-objects').replace('$0.20/ GB-month', 'see the storage page');
  assert.throws(() => parseSource(source('cloudflare-durable-objects'), gone), /sqlite_usd_per_gb_month not found/);
  assert.throws(() => parseSource(source('stripe-tax'), ''), /empty page/);
});

test('one figure stated twice with two values fails closed (in-person 2.7% beside online 2.9%)', () => {
  const twice = `${fixture('stripe-billing')} 0.9% of Billing volume`;
  assert.throws(() => parseSource(source('stripe-billing'), twice), /ambiguous .*0\.7 vs 0\.9/);
});

test('HTML is reduced to text before parsing; Cloudflare is fetched as Markdown', () => {
  assert.equal(textOf(source('stripe-tax'), '<p>No-code <b>integration</b></p>\n<script>x</script>  0.5%&nbsp;per'), ' No-code integration 0.5% per');
  assert.equal(fetchUrl(source('cloudflare-r2')), 'https://developers.cloudflare.com/r2/pricing/index.md');
  assert.equal(fetchUrl(source('stripe-tax')), 'https://stripe.com/tax/pricing');
});

test('a trimmed fixture still parses to the same figures', () => {
  for (const s of SOURCES) {
    const body = fixture(s.id);
    assert.deepEqual(parseSource(s, trimForFixture(s, body, 40)), parseSource(s, body), s.id);
  }
  assert.throws(() => trimForFixture(source('stripe-tax'), fixture('stripe-tax')), /positive margin/);
});
