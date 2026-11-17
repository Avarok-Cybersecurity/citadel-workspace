/**
 * The "Have a code?" field, walked inside create-workspace-walkthrough.mjs:
 * the mock answer for `POST /api/coupons/preview`, and the plan-step and
 * review-step checks -- every state on screen, measured for overflow and axe
 * by the walkthrough's `inspect`, plus the geometry no overflow check can see:
 * the input and its button side by side without colliding, inside the field,
 * and every control at least 44 px tall.
 *
 * The preview contract, as agreed with the Worker stream:
 *   200 { applies: true, kind: 'discount' | 'trial' | 'comp', ... }
 *   400 { error: 'coupon-unavailable', detail } for every refusal
 *   429 { error: 'coupon-rate-limited', detail }
 */

const ANSWERS = {
  LAUNCH10: [200, { applies: true, kind: 'discount', percent_off: 10, duration: 'once' }],
  TRIAL14: [200, { applies: true, kind: 'trial', days: 14 }],
  'PARTNER-ACME': [200, { applies: true, kind: 'comp', tier_as: 'business', seats: 25 }],
  'TOO-MANY': [429, { error: 'coupon-rate-limited', detail: 'Too many attempts. Try again in an hour.' }],
};
const REFUSED = [400, { error: 'coupon-unavailable', detail: 'that code cannot be applied to this plan' }];

/** The mock control plane's answer to a preview; `json(status, body)` fulfils the route. */
export function couponPreview(request, json) {
  const body = request.postDataJSON();
  if (body.tier !== 'team' && body.tier !== 'business') return json(...REFUSED);
  return json(...(ANSWERS[body.code] ?? REFUSED));
}

async function geometry(page) {
  return page.evaluate(() => {
    const box = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect() ?? null;
    const field = box('coupon-field');
    const input = box('coupon-input');
    const button = box('coupon-apply') ?? box('coupon-remove');
    const toggle = box('coupon-toggle');
    const status = box('coupon-status');
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const inside = (a) => a.left >= field.left - 0.5 && a.right <= field.right + 0.5;
    return {
      collides: overlap(input, button) > 0 || overlap(button, status) > 0 || overlap(input, status) > 0,
      escapes: [input, button, status].some((a) => !inside(a)),
      shortest: Math.min(input.height, button.height, toggle.height),
    };
  });
}

async function measure(page, record, label) {
  const g = await geometry(page);
  record(`${label}: input, button and status do not collide`, !g.collides);
  record(`${label}: nothing leaves the field`, !g.escapes);
  record(`${label}: every control is at least 44 px tall`, g.shortest >= 44, `shortest ${g.shortest}px`);
}

async function apply(page, code, state) {
  await page.getByTestId('coupon-input').fill(code);
  await page.getByTestId('coupon-apply').click();
  await page.locator(`[data-testid="coupon-field"][data-state="${state}"]`).waitFor();
}

/**
 * On a paid plan step: a refused code, the attempt cap, then LAUNCH10 applied,
 * then the review step showing it. Leaves the page on review with LAUNCH10 held.
 */
export async function walkCoupons(page, tag, inspect, record) {
  await page.getByTestId('coupon-toggle').click();
  await apply(page, 'NOT-A-CODE', 'unavailable');
  record(tag('refused code says so'), (await page.getByTestId('coupon-status').innerText()).includes("can't be applied to this plan"));
  await measure(page, record, tag('coupon refused'));
  await inspect(page, tag('06a-coupon-refused'));
  await apply(page, 'TOO-MANY', 'rate-limited');
  await inspect(page, tag('06b-coupon-rate-limited'));
  await apply(page, 'LAUNCH10', 'applied');
  const line = await page.getByTestId('coupon-preview-line').innerText();
  record(tag('LAUNCH10 previewed'), line === '10% off the first payment', line);
  await measure(page, record, tag('coupon applied'));
  await inspect(page, tag('06c-coupon-applied'));
  await page.getByTestId('create-plan-continue').click();
  await page.getByTestId('create-submit').and(page.locator(':enabled')).waitFor();
  const reviewed = await page.getByTestId('review-coupon').innerText();
  record(tag('review shows the code'), reviewed === 'LAUNCH10: 10% off the first payment', reviewed);
  record(tag('review shows what is due today'), (await page.getByTestId('review-due-today').count()) === 1);
}
