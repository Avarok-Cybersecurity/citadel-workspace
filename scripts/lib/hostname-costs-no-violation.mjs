/**
 * Walk a real user's registration path with a HOSTNAME in the address field and
 * report every Content-Security-Policy violation the browser raises on the way.
 *
 * Why this exists, precisely
 * --------------------------
 * check-production-image.mjs already asserts "no unexpected CSP violations",
 * but it attaches its collector to ONE page and looks only at the landing view.
 * work.avarok.net shipped for weeks with a build whose registration path did
 *
 *     fetch('https://dns.google/resolve?name=<host>&type=A')
 *
 * to turn the typed hostname into an IP before handing it to the local agent.
 * The site's own policy is `connect-src 'self' wss://local.<domain>:12345`, so
 * the browser refused it, the address never resolved, and every new user waited
 * thirty seconds for "Registration timed out" -- a message naming nothing real.
 * The landing page raised no violation, so the existing gate was green the whole
 * time. It was not wrong; its reach simply stopped three screens earlier than
 * the defect.
 *
 * The walk therefore goes all the way to submit. It needs NO server and NO
 * agent: the refused request happens in the page, before anything is sent, so
 * the registration failing afterwards is expected and is not what is asserted.
 *
 * What it does NOT prove: that resolution succeeds. Only that resolving does not
 * require the page to make a request its own policy forbids. Whether the agent
 * can reach the host is the agent's business, and smoke-agent.sh's concern.
 */

/** Attach a CDP Audits collector to `page`; returns a getter for CSP issues. */
export async function watchCspViolations(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Audits.enable');
  const issues = [];
  cdp.on('Audits.issueAdded', (e) => issues.push(e.issue));
  return () => issues
    .filter((i) => i.code === 'ContentSecurityPolicyIssue')
    .map((i) => i.details?.contentSecurityPolicyIssueDetails ?? {})
    // Eval is granted by the production policy, so an eval refusal here means
    // something unrelated to this walk; every other violation type counts.
    .filter((d) => d.contentSecurityPolicyViolationType !== 'kEvalViolation');
}

/**
 * @returns {Promise<{reached: string, violations: string[], detail: string}>}
 *   `reached` is the furthest wizard step observed, so a walk that breaks for an
 *   unrelated UI reason reports WHERE rather than silently reporting zero
 *   violations -- a walk that never ran also sees none.
 */
export async function walkRegistrationWithHostname(browser, origin, hostname) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const violations = await watchCspViolations(context, page);
  const out = { reached: 'nothing', violations: [], detail: '' };
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.click('[data-testid="create-account-button"]', { timeout: 30_000 });
    await page.click('[data-testid="onboarding-intent-member"]', { timeout: 15_000 });
    await page.waitForSelector('[data-testid="wizard-next"]', { timeout: 15_000 });
    out.reached = 'wizard';

    const dlg = page.locator('[role="dialog"]');
    await dlg.locator('#serverAddress').fill(hostname);
    await dlg.getByRole('button', { name: /next/i }).first().click();
    await page.waitForTimeout(2_000);
    out.reached = 'security';

    await dlg.getByRole('button', { name: /next|continue/i }).first().click();
    await page.waitForTimeout(2_000);
    out.reached = 'profile';

    const user = `cspwalk${process.pid}`;
    await dlg.locator('#fullName').fill(user);
    await dlg.locator('#username').fill(user);
    await dlg.locator('#password').fill('test12345');
    await dlg.locator('#confirmPassword').fill('test12345');
    await dlg.getByTestId('join-submit').click();
    out.reached = 'submitted';
    // The refused fetch is synchronous with the submit handler; the 30s
    // registration timeout that follows is not waited for on purpose.
    await page.waitForTimeout(6_000);
  } catch (error) {
    out.detail = String(error).split('\n')[0];
  }
  out.violations = violations().map(
    (d) => `${d.violatedDirective}:${(d.blockedURL ?? '').slice(0, 60)}`,
  );
  await context.close();
  return out;
}
