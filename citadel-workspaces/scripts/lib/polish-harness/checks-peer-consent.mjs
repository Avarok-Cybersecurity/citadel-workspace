import { strict as assert } from 'node:assert';

/**
 * A member's P2P consent panel at 375px (the narrowest phone this app is laid out for) and on a
 * desktop: no sideways scroll, every switch, button and the block field inside the panel, each a
 * 44px target, the metadata disclosure drawn under both P2P planes, and a long blocked username
 * wrapping inside its row rather than pushing Unblock off it.
 */
const thePeerConsentPanelFits = (scenario, blockedRows) => async ({ page, url, viewport }) => {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  try {
    await page.goto(url(scenario));
    const panel = page.getByTestId('apps-peer-consent');
    await panel.waitFor({ state: 'visible' });
    const box = await panel.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 0.5, `the panel ${JSON.stringify(box)} leaves the ${width}px viewport`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
    const targets = await panel.locator('button, input, label').evaluateAll(
      // A switch is drawn smaller than its target; the label around it is the 44px target (as CapabilityRows).
      (nodes) => nodes.filter((n) => n.getClientRects().length > 0).map((n) => ({ id: n.dataset.testid ?? n.getAttribute('for') ?? n.tagName, sized: n.getAttribute('role') !== 'switch', ...n.getBoundingClientRect().toJSON() })),
    );
    assert.ok(targets.length >= 6, `the scenario draws its controls, found ${targets.length}`);
    for (const t of targets) {
      assert.ok(t.x >= box.x - 0.5 && t.x + t.width <= box.x + box.width + 0.5, `${t.id} ${JSON.stringify(t)} overhangs the panel ${JSON.stringify(box)}`);
      if (t.sized && t.id !== 'INPUT') assert.ok(t.height >= 44 && t.width >= 44, `${t.id} is a ${t.width}x${t.height} target`);
    }
    assert.equal(await page.getByTestId('apps-peer-disclosure').count(), 2, 'the server-metadata line is drawn under serve and call');
    const rows = page.getByTestId('apps-peer-blocked-row');
    assert.equal(await rows.count(), blockedRows, 'every blocked person has a row');
    for (let i = 0; i < blockedRows; i++) {
      const row = await rows.nth(i).boundingBox();
      const unblock = await rows.nth(i).getByTestId('apps-peer-unblock').boundingBox();
      assert.ok(row.x + row.width <= box.x + box.width + 0.5, `blocked row ${i} ${JSON.stringify(row)} overhangs the panel`);
      assert.ok(unblock.x + unblock.width <= row.x + row.width + 0.5, `Unblock ${JSON.stringify(unblock)} is pushed off row ${i} ${JSON.stringify(row)}`);
    }
  } finally {
    await page.setViewportSize(viewport);
  }
};

export const PEER_CONSENT_CHECKS = {
  thePeerConsentPanelFitsUnanswered: thePeerConsentPanelFits('peer-consent-unanswered', 0),
  thePeerConsentPanelFitsWithLongBlockedNames: thePeerConsentPanelFits('peer-consent-answered', 2),
};
