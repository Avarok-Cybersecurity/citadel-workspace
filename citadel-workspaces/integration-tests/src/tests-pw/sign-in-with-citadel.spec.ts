/**
 * "Sign in with Citadel" (/sign-in) against the REAL agent of the stack, with the issuer played by
 * this spec: the page under test creates an identity in the agent, shows the consent dialog, has
 * the agent sign the issuer's challenge, proves it, and form-POSTs the code to the client's return.
 *
 * The local stack has no issuer (it lives in the tenant Worker on work.avarok.net), so
 * `/sign-in/clients.json`, `/begin` and `/prove` are answered here, from the contract's fixtures,
 * and the return (https://synchronized.work/auth/return) is caught before it leaves the browser.
 * What is real: the page, the agent socket, `IdentityStatus`/`IdentityCreate`/`IdentityExport`/
 * `IdentitySignChallenge`, the proof's bytes, and the browser's own CSP deciding whether the form
 * may POST to the return at all (form-action).
 *
 * The proof is read field by field (identity-api.md §7a: `0x01 ‖ str16(issuer) ‖ str16(aud) ‖
 * str16(origin) ‖ nonce ‖ challenge ‖ pk ‖ sig`), so the spec fails if the agent signed another
 * issuer, audience, origin, nonce or challenge than the page asked for.
 *
 * The identity is agent-wide and this stack's agent is shared by the shard: a retry, or a second
 * run on the same stack, finds the identity this spec created and signs with the same password.
 * No other spec creates one.
 */
import { test, expect, type Page, type Request, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { config } from '../lib/config.js';

const FIXTURES: string = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/contracts/batch-1116/fixtures/sign-in-with-citadel');
const fixture = (path: string): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, path), 'utf8')) as Record<string, unknown>;

/** Fixed, because the identity outlives one attempt of this spec (see above). */
const UNLOCK_PASSWORD: string = 'sign-in-spec-unlock-password';
const LINK: Record<string, string> = fixture('SignInLink/valid-browser.json') as Record<string, string>;
const ISSUER: string = 'work.avarok.net';
const CODE: string = 'K7QM-2XRA';
/** sign-in-kat.json `match_phrase.words` for the fixture's challenge. */
const MATCH_WORDS: string[] = ['argue', 'occur', 'napkin'];

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

interface Issued { begin: Record<string, unknown> | null; proof: string | null; nonce: Uint8Array; returned: string | null }

async function playIssuer(page: Page): Promise<Issued> {
  const issued: Issued = { begin: null, proof: null, nonce: new Uint8Array(randomBytes(32)), returned: null };
  const json = (route: Route, body: unknown): Promise<void> => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/sign-in/clients.json', (route: Route) => json(route, fixture('ReturnAllowlist/valid.json')));
  await page.route('**/sign-in/begin', (route: Route) => {
    issued.begin = route.request().postDataJSON() as Record<string, unknown>;
    return json(route, {
      v: 1, attempt: b64url(new Uint8Array(randomBytes(16))), nonce: b64url(issued.nonce), issuer: ISSUER,
      aud: LINK.client, display_name: 'synchronized.work', expires_in_s: 300,
    });
  });
  await page.route('**/sign-in/prove', (route: Route) => {
    issued.proof = (route.request().postDataJSON() as { proof: string }).proof;
    return json(route, { v: 1, code: CODE, return: LINK.return, state: LINK.state });
  });
  await page.route(LINK.return, (route: Route) => {
    const request: Request = route.request();
    issued.returned = `${request.method()} ${request.postData() ?? ''}`;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>returned</title><p id="returned">returned</p>' });
  });
  return issued;
}

/** The proof's leading fields (identity-api.md §7a). */
function readProof(proof: string): { version: number; issuer: string; aud: string; origin: string; nonce: Buffer; challenge: Buffer } {
  const blob: Buffer = Buffer.from(proof, 'base64url');
  let at: number = 1;
  const str16 = (): string => {
    const len: number = blob.readUInt16BE(at);
    const text: string = blob.subarray(at + 2, at + 2 + len).toString('utf8');
    at += 2 + len;
    return text;
  };
  const issuer: string = str16();
  const aud: string = str16();
  const origin: string = str16();
  const nonce: Buffer = blob.subarray(at, at + 32);
  const challenge: Buffer = blob.subarray(at + 32, at + 64);
  return { version: blob[0], issuer, aud, origin, nonce, challenge };
}

/** Creates the identity when the agent has none; a retry finds the one this spec made. */
async function throughIdentityCreation(page: Page): Promise<void> {
  const create = page.getByTestId('sign-in-create-identity');
  const dialog = page.getByTestId('sign-in-consent');
  await expect(create.or(dialog)).toBeVisible({ timeout: 60_000 });
  if (!(await create.isVisible())) return;
  await page.getByLabel('Unlock password').fill(UNLOCK_PASSWORD);
  await page.getByLabel('Type it again').fill(UNLOCK_PASSWORD);
  await page.getByTestId('sign-in-create').click();
  const phrase = page.getByTestId('sign-in-recovery-phrase');
  await expect(phrase).toBeVisible({ timeout: 60_000 });
  const words: string[] = (await phrase.locator('li').allTextContents()).map((t: string) => t.replace(/^\d+\.\s*/, '').trim());
  expect(words).toHaveLength(24);
  await page.getByTestId('sign-in-phrase-written').click();
  const check = page.getByTestId('sign-in-phrase-check');
  for (const label of await check.locator('label').allTextContents()) {
    const position: number = Number(/Word (\d+)/.exec(label)?.[1]);
    await check.getByLabel(label, { exact: true }).fill(words[position - 1]);
  }
  await page.getByTestId('sign-in-phrase-confirm').click();
}

test.describe('Sign in with Citadel', () => {
  // One agent, one identity: the two must not race to create it.
  test.describe.configure({ mode: 'serial' });

  test('the agent signs exactly what the page asked, and the code is POSTed to the return', async ({ page }) => {
    const issued: Issued = await playIssuer(page);
    await page.goto(`${config.BASE_URL}/sign-in?${new URLSearchParams(LINK).toString()}`, { waitUntil: 'commit', timeout: 60_000 });

    await throughIdentityCreation(page);
    const dialog = page.getByTestId('sign-in-consent');
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    expect(issued.begin).toEqual({ v: 1, client: LINK.client, challenge: LINK.challenge, state: LINK.state, return: LINK.return });
    await expect(dialog.getByTestId('sign-in-match-words').locator('li')).toHaveText(MATCH_WORDS);
    await expect(dialog.getByTestId('sign-in-approve')).toBeDisabled();

    await dialog.getByTestId('sign-in-unlock-password').fill(UNLOCK_PASSWORD);
    await dialog.getByTestId('sign-in-approve').click();

    await expect.poll(() => issued.returned, { timeout: 60_000 }).not.toBeNull();
    expect(issued.returned).toBe(`POST ${new URLSearchParams({ code: CODE, state: LINK.state }).toString()}`);

    const proof = readProof(issued.proof ?? '');
    expect(proof.version).toBe(1);
    expect(proof.issuer).toBe(ISSUER);
    expect(proof.aud).toBe(LINK.client);
    expect(proof.origin).toBe(new URL(config.BASE_URL).origin);
    expect(proof.nonce.equals(Buffer.from(issued.nonce))).toBe(true);
    expect(proof.challenge.equals(Buffer.from(LINK.challenge, 'base64url'))).toBe(true);
  });

  test('Cancel posts nothing and proves nothing', async ({ page }) => {
    const issued: Issued = await playIssuer(page);
    await page.goto(`${config.BASE_URL}/sign-in?${new URLSearchParams(LINK).toString()}`, { waitUntil: 'commit', timeout: 60_000 });
    await throughIdentityCreation(page);
    const dialog = page.getByTestId('sign-in-consent');
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.getByTestId('sign-in-cancel').click();
    await expect(page.getByTestId('sign-in-cancelled')).toBeVisible();
    expect(issued.proof).toBeNull();
    expect(issued.returned).toBeNull();
  });
});
