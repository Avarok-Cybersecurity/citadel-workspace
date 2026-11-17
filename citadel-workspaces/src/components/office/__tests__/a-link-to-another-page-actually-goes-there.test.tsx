/**
 * Clicking a link in a document to another page in the workspace goes there.
 *
 * Reported as "nothing happens". The office MDX map rendered every link as a
 * bare `<a href>`, so a link to `/workspace?nodeId=…` was a FULL DOCUMENT LOAD,
 * not a router navigation — and a reload in this app tears down the WASM client
 * and the WebSocket to the local agent, so the app comes back in its reconnect
 * path rather than at the node you asked for.
 *
 * The discriminating assertion is the router's location AFTER the click. jsdom
 * does not implement document navigation, so a plain `<a href>` moves nothing
 * and the location stays put — which is exactly the production symptom, and why
 * this test goes red the moment the anchor stops going through the router.
 *
 * These render REAL MDX through the real compile path (`useCompiledMdx` +
 * `components`), not a hand-built anchor, so the wiring between the document
 * pipeline and the link component is part of what is under test.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import { MDXProvider } from '@mdx-js/react';
import { components } from '../mdxComponents';
import { useCompiledMdx, type CompiledMdx } from '../use-compiled-mdx';

function Document({ source }: { source: string }): JSX.Element {
  const { compiled }: CompiledMdx = useCompiledMdx(source, components, undefined, false);
  return <MDXProvider components={components}>{compiled}</MDXProvider>;
}

/** Reports where the ROUTER thinks we are, which is what navigation changes. */
function CurrentLocation(): JSX.Element {
  const location: Location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderDocument(source: string): void {
  render(
    <MemoryRouter initialEntries={['/workspace?nodeId=start']}>
      <CurrentLocation />
      <Document source={source} />
    </MemoryRouter>,
  );
}

describe('a document link that points at another workspace page', () => {
  it('navigates inside the app instead of reloading it', async () => {
    const user: UserEvent = userEvent.setup();
    renderDocument('See [the other page](/workspace?nodeId=other) for details.\n');

    const link: HTMLElement = await screen.findByRole('link', { name: 'the other page' });
    expect(screen.getByTestId('location')).toHaveTextContent('/workspace?nodeId=start');

    await user.click(link);

    // The router moved. A bare <a href> cannot do this in jsdom, and in a real
    // browser would have reloaded the document to get here.
    await waitFor((): void => {
      expect(screen.getByTestId('location')).toHaveTextContent('/workspace?nodeId=other');
    });
  });

  it('navigates for a full URL of this app, the form people copy from the address bar', async () => {
    const user: UserEvent = userEvent.setup();
    // window.location.origin under jsdom; the link is same-origin, so it is an
    // internal link wearing an absolute URL, and must not leave the SPA.
    renderDocument(`Go to [the roadmap](${window.location.origin}/workspace?nodeId=roadmap).\n`);

    await user.click(await screen.findByRole('link', { name: 'the roadmap' }));

    await waitFor((): void => {
      expect(screen.getByTestId('location')).toHaveTextContent('/workspace?nodeId=roadmap');
    });
  });

  it('leaves a real external link alone, and opens it severed from this tab', async () => {
    const user: UserEvent = userEvent.setup();
    renderDocument('Read [the spec](https://example.com/spec) first.\n');

    const link: HTMLElement = await screen.findByRole('link', { name: 'the spec' });
    expect(link).toHaveAttribute('href', 'https://example.com/spec');
    expect(link).toHaveAttribute('target', '_blank');
    // Without noopener the opened page can reach back through window.opener.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    await user.click(link);

    // An external link must NOT move the router; the negative half of the rule.
    expect(screen.getByTestId('location')).toHaveTextContent('/workspace?nodeId=start');
  });

  it('refuses to make a javascript: href clickable at all', async () => {
    // The office path runs @mdx-js evaluate(), which — unlike react-markdown —
    // has no urlTransform. Document bytes are authored by other workspace
    // members, so this href reached the DOM live before DocumentLink.
    renderDocument('Careful: [click me](javascript:alert(1)) now.\n');

    const text: HTMLElement = await screen.findByText('click me');
    expect(text.tagName).toBe('SPAN');
    expect(screen.queryByRole('link', { name: 'click me' })).toBeNull();
  });
});
