import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The orphan-session disconnect button must be a real 24x24 target.
 *
 * Source-level, because jsdom lays nothing out and the Lighthouse target-size
 * audit that catches this only runs when orphan sessions exist -- which CI's
 * production-image check never has. So the audit passed in CI while a real
 * user's thumb landed on the session button underneath and switched
 * workspaces instead of disconnecting.
 *
 * The previous fix grew a ::before pseudo-element and its comment claimed
 * 24px. Measured live: the button was 14x14 and the pseudo 19x19. This pins
 * the two facts that fix actually depended on and never checked:
 *
 *   1. the size is in explicit px, not rem -- the root font-size here is 14px,
 *      so w-4 is 14px and even w-6 would be 21px, both under the floor;
 *   2. the sized element is the BUTTON itself, which is what the audit and the
 *      pointer both measure. A pseudo-element satisfies neither.
 */
const src: string = readFileSync(join(__dirname, '..', 'OrphanSessionIcon.tsx'), 'utf8');
// The disconnect button's own opening tag only: from the last `<button` before
// its testid up to that testid. A wider window reached the avatar, whose
// `w-6 h-6 rounded-full` is fine there and made this test fail correct code.
const end: number = src.indexOf('data-testid={`disconnect-button-');
const start: number = src.lastIndexOf('<button', end);
const button: string = src.slice(start, end);

describe('the disconnect target', () => {
  it('is an explicit 24px box on the button element', () => {
    expect(button).toMatch(/w-\[24px\] h-\[24px\]/);
  });
  it('is not sized in rem, which the 14px root font shrinks', () => {
    expect(button).not.toMatch(/"[^"]*\b[wh]-[46]\b[^"]*rounded-full/);
  });
  it('does not rely on a pseudo-element for its hit area', () => {
    expect(button).not.toMatch(/before:-inset/);
  });
});
