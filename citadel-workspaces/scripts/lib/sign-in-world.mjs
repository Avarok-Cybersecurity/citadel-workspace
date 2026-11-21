/**
 * "Sign in with Citadel" (/sign-in) in the world the browser gates measure: `vite preview`, the
 * agent port pinned closed (preview-world.mjs), no issuer. The issuer's public allowlist is served
 * from the contract's own fixture so the page accepts the link, and with no agent it settles on the
 * install screen without ever asking the issuer to begin. A malformed link settles on the refusal.
 *
 * The page declares itself agent-optional (lib/onboarding/agent-optional.ts), so the connection-retry
 * dialog the other screens dismiss never opens here: waiting to dismiss it would wait for nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = (appRoot) => join(appRoot, '..', 'docs', 'contracts', 'batch-1116', 'fixtures', 'sign-in-with-citadel');

/** Serves `/sign-in/clients.json` from the contract fixture, and fails any `begin` loudly (none must happen without an agent). */
export async function serveSignInIssuer(context, appRoot) {
  const allowlist = readFileSync(join(FIXTURES(appRoot), 'ReturnAllowlist', 'valid.json'), 'utf8');
  await context.route('**/sign-in/clients.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: allowlist }));
  await context.route('**/sign-in/begin', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"gate","detail":"begin without an agent"}' }));
}

/** The screens, as `[name, go]` pairs: each navigates and waits for its own surface. */
export function signInScreens(page, origin, appRoot) {
  const link = JSON.parse(readFileSync(join(FIXTURES(appRoot), 'SignInLink', 'valid-browser.json'), 'utf8'));
  return [
    ['sign-in-with-citadel/no-agent', async () => {
      await page.goto(`${origin}/sign-in?${new URLSearchParams(link)}`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('sign-in-no-agent').waitFor({ state: 'visible', timeout: 30_000 });
    }],
    ['sign-in-with-citadel/refused', async () => {
      await page.goto(`${origin}/sign-in?client=${encodeURIComponent(link.client)}`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('sign-in-refused').waitFor({ state: 'visible', timeout: 30_000 });
    }],
  ];
}

export const AGENT_OPTIONAL_SCREENS = new Set(['sign-in-with-citadel/no-agent', 'sign-in-with-citadel/refused']);
