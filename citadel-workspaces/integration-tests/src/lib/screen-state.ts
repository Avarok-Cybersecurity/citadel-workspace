/**
 * What was on the screen when a wait gave up.
 *
 * Twelve helpers in this library ended a failed wait with a bare line —
 * `Workspace loading timeout`, `Tree data loading timeout`, `Message not found
 * within 30000ms`. Each of those is a report with no evidence in it. A CI leg
 * that fails this way leaves nothing to work from: not the URL, not whether a
 * modal was sitting over the app, not whether the page was still loading, not
 * what it actually said. Three failure families in this repository stayed
 * "environmental and unexplained" for weeks behind exactly that.
 *
 * The state is captured at the moment of the give-up, because a screenshot
 * taken afterwards has already moved on and a log line written afterwards was
 * never about the screen at all.
 */
import type { Page } from 'playwright';

export interface ScreenState {
  url: string;
  /** Dialog titles, outermost first. A modal over the app explains most waits. */
  dialogs: string[];
  /** Whether anything is still saying it is loading. */
  loading: string[];
  /** Headings, which name the screen when the URL does not. */
  headings: string[];
  /** Error toasts showing right now. */
  errors: string[];
  /** The first of the body text, for when none of the above says enough. */
  text: string;
}

export async function describeScreen(page: Page): Promise<ScreenState> {
  const empty: ScreenState = {
    url: 'unavailable',
    dialogs: [],
    loading: [],
    headings: [],
    errors: [],
    text: '',
  };
  try {
    return await page.evaluate(() => {
      // By RECTANGLE, not `offsetParent`. A `position: fixed` element always
      // reports a null offsetParent, and every dialog in this app is fixed --
      // so the offsetParent version reported "dialogs: none" while a modal was
      // sitting over the screen, which is the single most useful thing this
      // capture can say.
      const visible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const text = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      return {
        url: location.href,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]'))
          .filter(visible)
          .map((d) => text(d.querySelector('h1,h2,h3') ?? d).slice(0, 60)),
        loading: Array.from(document.querySelectorAll('*'))
          .filter((el) => el.children.length === 0 && /loading|connecting/i.test(text(el)))
          .filter(visible)
          .map((el) => text(el).slice(0, 60))
          .slice(0, 4),
        headings: Array.from(document.querySelectorAll('h1,h2,h3'))
          .filter(visible)
          .map((h) => text(h).slice(0, 40))
          .slice(0, 6),
        errors: Array.from(document.querySelectorAll('[data-sonner-toast][data-type="error"]'))
          .map((t) => text(t).slice(0, 80)),
        text: (document.body.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 240),
      };
    });
  } catch {
    // A closed page, a navigation mid-capture, a crashed context. The wait had
    // already failed; losing its diagnosis to a second failure would put us back
    // where we started, so this reports what it can and never throws.
    return { ...empty, url: page.url?.() ?? 'unavailable' };
  }
}

/**
 * Report a wait that gave up, with the screen it gave up on.
 *
 * Use this instead of `console.log('  ...timeout')`. A rule in the UI package's
 * test suite fails if a bare timeout line comes back.
 */
export async function reportTimeout(page: Page, message: string): Promise<void> {
  const state = await describeScreen(page);
  const lines = [
    `  ${message}`,
    `    url:      ${state.url}`,
    `    dialogs:  ${state.dialogs.length ? state.dialogs.join(' | ') : 'none'}`,
    `    loading:  ${state.loading.length ? state.loading.join(' | ') : 'nothing says loading'}`,
    `    headings: ${state.headings.length ? state.headings.join(' | ') : 'none'}`,
    `    errors:   ${state.errors.length ? state.errors.join(' | ') : 'none'}`,
    `    screen:   ${state.text || '(empty body)'}`,
  ];
  console.log(lines.join('\n'));
}
