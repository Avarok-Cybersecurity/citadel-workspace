import { strict as assert } from 'node:assert';

/** The running animations on the element `testId` names, after one frame so a newly applied class has taken effect. */
async function animationsOn(page, testId) {
  return page.getByTestId(testId).evaluate(async (el) => {
    await new Promise((done) => requestAnimationFrame(() => done()));
    return el.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName ?? 'unnamed');
  });
}

/**
 * The channel's "is typing" line pulses under Full motion only. Lite keeps nothing that pulses for
 * attention (index.css, `.lite-motion .animate-pulse`), and the OS reduced-motion preference keeps
 * nothing moving at all (`motion-safe:`). The harness runs under reduced motion, so this check asks
 * for no preference itself and puts the run's setting back when it is done.
 */
async function theTypingLinePulsesOnlyUnderFullMotion({ page, url }) {
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(url('node-chat'));
    const typing = page.getByTestId('node-chat-typing');
    await typing.getByText('Grace Hopper', { exact: false }).waitFor({ state: 'visible' });
    const full = await animationsOn(page, 'node-chat-typing');
    assert.ok(full.length > 0, 'under Full motion the typing line does not pulse, so this check measures nothing');
    await page.evaluate(() => document.documentElement.classList.add('lite-motion'));
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('lite-motion')), 'the Lite class did not stay on the page');
    assert.deepEqual(await animationsOn(page, 'node-chat-typing'), [], 'under Lite motion the typing line still moves');
    await page.evaluate(() => document.documentElement.classList.remove('lite-motion'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.deepEqual(await animationsOn(page, 'node-chat-typing'), [], 'with reduced motion asked for, the typing line still moves');
  } finally {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
}

export const MOTION_CHECKS = { theTypingLinePulsesOnlyUnderFullMotion };
