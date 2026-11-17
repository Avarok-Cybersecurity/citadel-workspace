import { strict as assert } from 'node:assert';

/** The least air between two siblings in a row that still reads as two things, in CSS px. */
export const MIN_SIBLING_GAP = 4;

/**
 * Walks every flex or grid container on the page and reports (a) a child that sticks out of its
 * container, which no document-width check can see because the page never scrolls, and (b) two
 * neighbouring children in a row that overlap or touch. Both are reported with a selector path.
 */
export function collisions({ minGap }) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed';
  };
  const hasContent = (el) => el.matches('button, a, svg, img, input, select, textarea, [role="button"]') || (el.textContent ?? '').trim().length > 0;
  const name = (el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/).slice(0, 3).join('.')}` : ''}`;
  const found = [];
  for (const parent of document.body.querySelectorAll('*')) {
    const ps = getComputedStyle(parent);
    if (!/flex|grid/.test(ps.display) || !visible(parent) || parent.closest('[aria-hidden="true"]')) continue;
    const pr = parent.getBoundingClientRect();
    const kids = [...parent.children].filter(visible);
    if (ps.overflowX === 'visible') {
      for (const kid of kids) {
        // A negative margin is a decision (an icon button's glyph aligned to the text edge), not an accident.
        const ks = getComputedStyle(kid);
        if (parseFloat(ks.marginLeft) < 0 || parseFloat(ks.marginRight) < 0) continue;
        const kr = kid.getBoundingClientRect();
        if (kr.left < pr.left - 1 || kr.right > pr.right + 1) found.push(`${name(kid)} sticks out of ${name(parent)} by ${Math.round(Math.max(pr.left - kr.left, kr.right - pr.right))}px`);
      }
    }
    if (!/row/.test(ps.flexDirection) || ps.flexWrap !== 'nowrap' || ps.display.includes('grid')) continue;
    // Left to right as painted: a row-reverse lists its children in the opposite order to the page.
    const content = kids.filter(hasContent).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    for (let i = 1; i < content.length; i += 1) {
      const a = content[i - 1].getBoundingClientRect();
      const b = content[i].getBoundingClientRect();
      const sameLine = a.top < b.bottom && b.top < a.bottom;
      // A child that grows to fill the row carries its own padding; its far edge is the row's edge.
      const fills = parseFloat(getComputedStyle(content[i - 1]).flexGrow) > 0 || content[i - 1].matches('.w-full');
      if (sameLine && !fills && b.left - a.right < minGap) found.push(`${name(content[i - 1])} and ${name(content[i])} are ${Math.round(b.left - a.right)}px apart in ${name(parent)}`);
    }
  }
  return found;
}

const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), undefined, { timeout: 5000 });

export const checkScenario = (scenario, ready) => async ({ page, url }) => {
  await page.goto(url(scenario));
  await page.locator(ready).first().waitFor({ state: 'visible' });
  await settled(page);
  const found = await page.evaluate(collisions, { minGap: MIN_SIBLING_GAP });
  // Leave the screen: the landing page keeps timers and channels alive that would otherwise reach into the
  // NEXT check's navigation on this same page and take it away mid-measurement.
  await page.goto('about:blank');
  assert.equal(found.length, 0, `${scenario}: ${found.slice(0, 5).join(' | ')}`);
};

export const SPACING_CHECKS = {
  noCollisionsInAllMembers: checkScenario('all-members', '[data-testid^="all-members-row-"]'),
  noCollisionsInAFileShare: checkScenario('file-share', '[data-testid="group-file-share"]'),
  noCollisionsInFileProperties: checkScenario('file-properties', '[role="dialog"]'),
  noCollisionsInTheConversation: checkScenario('p2p-conversation', '[data-message-id]'),
  noCollisionsInTheSidebarMembers: checkScenario('sidebar-members', '[data-testid^="member-row-"]'),
  noCollisionsAmongPeople: checkScenario('people', '[data-avatar]'),
  noCollisionsInTheNodeChat: checkScenario('node-chat', '[data-message-id]'),
  noCollisionsInSettings: checkScenario('settings', '[role="dialog"]'),
  noCollisionsInConnectionSettings: checkScenario('settings-connections', '[role="dialog"]'),
  noCollisionsInAppearanceSettings: checkScenario('settings-appearance', '[role="dialog"]'),
  noCollisionsInPrivacySettings: checkScenario('settings-privacy', '[role="dialog"]'),
  noCollisionsInNotificationSettings: checkScenario('settings-notifications', '[data-testid="settings-notifications"]'),
  noCollisionsOnTheLandingPage: checkScenario('landing', 'h1'),
  noCollisionsInTheOfficeHeader: checkScenario('office-header', '[data-testid="hierarchy-breadcrumbs"]'),
};
