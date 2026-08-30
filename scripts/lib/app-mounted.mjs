/**
 * Did the application render, or did it crash and render the apology?
 *
 * Both production browser checks asked `document.getElementById('root').children
 * .length > 0` and called that "the app mounts". The root error boundary is a
 * child of #root. So when a hook threw on every render — `useNavigate()` in a
 * component mounted above the router — and every production load became
 * "Something went wrong", both checks stayed green and reported a mounted app.
 *
 * The distinction is now a fact the app states about itself: the boundary's
 * fallback carries `data-testid="app-crashed"`. Absence of that, plus a real
 * control the app renders, is what mounting means.
 */
export async function appMountState(page) {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    const children = root ? root.children.length : 0;
    const crashed = Boolean(document.querySelector('[data-testid="app-crashed"]'));
    // A control the landing page renders once React is running. Named testids
    // rather than button text, which a copy change silently breaks.
    const app = Boolean(
      document.querySelector('[data-testid="sign-in-button"]') ||
        document.querySelector('[data-testid="create-account-button"]') ||
        document.querySelector('[data-testid="app-shell"]'),
    );
    return { children, crashed, app };
  });
}

/** `{ ok, detail }` — ok only when the app itself rendered. */
export async function appMounted(page) {
  const { children, crashed, app } = await appMountState(page);
  if (crashed) return { ok: false, detail: 'rendered the error boundary, not the app' };
  if (children === 0) return { ok: false, detail: '#root is empty' };
  if (!app) return { ok: false, detail: '#root has children but no app control rendered' };
  return { ok: true, detail: null };
}
