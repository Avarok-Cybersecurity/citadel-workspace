/**
 * The upstream rate pages and one pure parser per page: page text in, { rateId: { value, raw } }
 * out, or a throw. A parser never guesses -- a figure it cannot find, or finds twice with two
 * different values, fails the whole run (scripts/rates/update-rates.mjs writes nothing).
 *
 * Cloudflare serves each docs page as clean Markdown at `<page>index.md`; Stripe's pages are HTML
 * and are reduced to text (tags dropped, whitespace collapsed) before the regexes run.
 *
 * Fixtures (billing/fixtures/<source id>.txt) are each page's parser input trimmed to the windows
 * around what the parsers match. Regenerate them all with:
 *   node scripts/rates/fetch-rates.mjs --fixtures billing/fixtures
 */

const num = '(\\d+(?:\\.\\d+)?)';

export const SOURCES = [
  {
    id: 'cloudflare-durable-objects',
    page: 'https://developers.cloudflare.com/durable-objects/platform/pricing/',
    format: 'markdown',
    rates: [
      { id: 'cloudflare.do.rows_written_usd_per_million', unit: 'USD per million rows written', re: `\\|\\s*Rows written[^|\\n]*\\|[^|\\n]*\\|[^|\\n]*\\+\\s*\\$${num}\\s*/\\s*million rows` },
      { id: 'cloudflare.do.requests_usd_per_million', unit: 'USD per million requests', re: `\\|\\s*Requests\\s*\\|[^|\\n]*\\|[^|\\n]*\\+\\s*\\$${num}\\s*/\\s*million` },
      { id: 'cloudflare.do.sqlite_usd_per_gb_month', unit: 'USD per GB-month (SQLite)', re: `\\|\\s*SQL Stored data[^|\\n]*\\|[^|\\n]*\\|[^|\\n]*\\+\\s*\\$${num}\\s*/\\s*GB-month` },
      { id: 'cloudflare.do.duration_usd_per_million_gbs', unit: 'USD per million GB-s', re: `\\|\\s*Duration[^|\\n]*\\|[^|\\n]*\\|[^|\\n]*\\+\\s*\\$${num}\\s*/\\s*million GB-s` },
    ],
  },
  {
    id: 'cloudflare-workers',
    page: 'https://developers.cloudflare.com/workers/platform/pricing/',
    format: 'markdown',
    rates: [
      { id: 'cloudflare.do.ws_messages_per_request', unit: 'incoming WebSocket messages per billed request', re: `a ${num}:1 ratio is applied to incoming WebSocket messages` },
    ],
  },
  {
    id: 'cloudflare-r2',
    page: 'https://developers.cloudflare.com/r2/pricing/',
    format: 'markdown',
    rates: [
      { id: 'cloudflare.r2.storage_usd_per_gb_month', unit: 'USD per GB-month (Standard)', re: `\\|\\s*Storage\\s*\\|\\s*\\$${num}\\s*/\\s*GB-month\\s*\\|` },
    ],
  },
  {
    id: 'cloudflare-turn',
    page: 'https://developers.cloudflare.com/realtime/turn/',
    format: 'markdown',
    rates: [
      { id: 'cloudflare.turn.usd_per_gb', unit: 'USD per GB outbound', re: `costs \\$${num}/real-time GB outbound` },
    ],
  },
  {
    id: 'cloudflare-email',
    page: 'https://developers.cloudflare.com/email-service/platform/pricing/',
    format: 'markdown',
    rates: [
      { id: 'cloudflare.email.usd_per_thousand', unit: 'USD per 1,000 emails beyond the included', re: `then \\$${num} per 1,000 emails` },
    ],
  },
  {
    id: 'stripe-payments',
    page: 'https://stripe.com/pricing',
    format: 'html',
    rates: [
      { id: 'stripe.card.percent', unit: 'percent per domestic card charge', re: `online payments\\. ${num}% \\+ \\d+¢ per successful transaction for domestic cards` },
      { id: 'stripe.card.fixed_usd', unit: 'USD per domestic card charge', re: `online payments\\. \\d+(?:\\.\\d+)?% \\+ ${num}¢ per successful transaction for domestic cards`, scale: 0.01 },
    ],
  },
  {
    id: 'stripe-billing',
    page: 'https://stripe.com/billing/pricing',
    format: 'html',
    rates: [
      { id: 'stripe.billing.percent', unit: 'percent of Billing volume (pay as you go)', re: `${num}% of Billing volume` },
    ],
  },
  {
    id: 'stripe-tax',
    page: 'https://stripe.com/tax/pricing',
    format: 'html',
    rates: [
      { id: 'stripe.tax.percent', unit: 'percent per transaction where registered (no-code)', re: `No-code integration ${num}% per transaction` },
    ],
  },
];

/** The URL actually fetched: Cloudflare's Markdown rendering, or the page itself. */
export function fetchUrl(source) {
  return source.format === 'markdown' ? `${source.page}index.md` : source.page;
}

const ENTITIES = { '&nbsp;': ' ', '&#160;': ' ', '&amp;': '&', '&#x27;': "'", '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };

/** What the regexes run over: Markdown as served; HTML with scripts, styles and tags dropped. */
export function textOf(source, body) {
  if (typeof body !== 'string' || body.length === 0) throw new Error(`${source.id}: empty page`);
  if (source.format === 'markdown') return body;
  if (source.format !== 'html') throw new Error(`${source.id}: unknown format ${source.format}`);
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160|amp|#x27|#39|quot|lt|gt);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, ' ');
}

/** Every match of one rate's regex in `text`. */
function matchesOf(rate, text) {
  return [...text.matchAll(new RegExp(rate.re, 'g'))];
}

/** { rateId: { value, raw } } for one page, or a throw naming what was not found. */
export function parseSource(source, body) {
  const text = textOf(source, body);
  const out = {};
  for (const rate of source.rates) {
    const found = matchesOf(rate, text);
    if (found.length === 0) throw new Error(`${source.id}: ${rate.id} not found on ${source.page}`);
    const values = new Set(found.map((m) => m[1]));
    if (values.size !== 1) throw new Error(`${source.id}: ${rate.id} is ambiguous on ${source.page} (${[...values].join(' vs ')})`);
    const value = Number((Number(found[0][1]) * (rate.scale ?? 1)).toFixed(9));
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${source.id}: ${rate.id} parsed to ${found[0][1]}`);
    out[rate.id] = { value, raw: found[0][0] };
  }
  return out;
}

/** The parser input cut to a window around every match, for a fixture. Throws if parsing would. */
export function trimForFixture(source, body, margin) {
  if (!Number.isInteger(margin) || margin <= 0) throw new Error("trimForFixture needs a positive margin");
  parseSource(source, body);
  const text = textOf(source, body);
  const spans = source.rates.flatMap((r) => matchesOf(r, text).map((m) => [Math.max(0, m.index - margin), Math.min(text.length, m.index + m[0].length + margin)]));
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged.at(-1);
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  return `${merged.map(([a, b]) => text.slice(a, b)).join('\n\n[...]\n\n')}\n`;
}
