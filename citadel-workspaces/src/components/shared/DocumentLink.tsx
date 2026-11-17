import { Link, useLocation, type Location } from 'react-router-dom';
import { classifyDocumentLink, type DocumentLinkTarget } from '@/lib/document-links';

/**
 * The one anchor for content this app did not write.
 *
 * Every renderer that turns author-supplied markdown or MDX into HTML routes
 * its `a` element through here, so the three rules — internal links navigate in
 * the SPA, external links open severed in a new tab, unsafe schemes do not
 * become links at all — are stated once. See `lib/document-links.ts` for why
 * each rule exists.
 *
 * Previously each renderer had its own inline `<a>`: the office document map
 * had one with no `target`/`rel` at all, the chat bubble map had one that sent
 * EVERY link to a new tab including workspace-internal ones, and the composer
 * preview had no map at all and fell through to react-markdown's default. Three
 * spellings of one decision, disagreeing with each other and none of them
 * reaching the router.
 */

/**
 * Shared by all call sites rather than passed in. These renderers are the same
 * surface — content the user is reading — and a link that looks different
 * depending on which one drew it would be a bug, not a feature.
 */
const LINK_CLASS: string = 'text-primary-accent hover:text-primary-accent underline';

export interface DocumentLinkProps {
  href?: string;
  children?: React.ReactNode;
}

/**
 * The `a` entry for a react-markdown or MDX component map.
 *
 * Exported so the three renderers share one adapter rather than each writing
 * its own wrapper around `DocumentLink` — which is how they drifted apart the
 * first time. Both libraries hand `a` an `href` and `children`, so one function
 * satisfies both.
 */
export const documentAnchor: (props: DocumentLinkProps) => JSX.Element = ({
  href,
  children,
}: DocumentLinkProps): JSX.Element => <DocumentLink href={href}>{children}</DocumentLink>;

export function DocumentLink({ href, children }: DocumentLinkProps): JSX.Element {
  const location: Location = useLocation();
  // The router owns the path; only the origin has to come from the browser, and
  // it is the origin alone that decides internal vs external. Composing them
  // here keeps `classifyDocumentLink` free of `window` so it stays unit-testable.
  const currentUrl: string = new URL(
    `${location.pathname}${location.search}`,
    window.location.origin,
  ).href;

  const target: DocumentLinkTarget = classifyDocumentLink(href, currentUrl);

  switch (target.kind) {
    case 'internal':
      // <Link>, not <a>: this is the whole point. A plain anchor here reloads
      // the document and takes the WASM client and the agent WebSocket with it.
      return (
        <Link to={target.to} className={LINK_CLASS}>
          {children}
        </Link>
      );

    case 'external':
      return (
        <a href={target.href} className={LINK_CLASS} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );

    case 'hash':
      return (
        <a href={target.href} className={LINK_CLASS}>
          {children}
        </a>
      );

    case 'inert':
      // The text survives; the link does not. Silently dropping the content
      // would hide that the document said something here, and rendering a dead
      // `<a>` would still look clickable — so it is marked, and the title says
      // why for anyone who wonders.
      return (
        <span
          data-inert-link="true"
          title="This link was not shown because its address is not a safe web address."
          className="text-muted-foreground underline decoration-dotted"
        >
          {children}
        </span>
      );
  }
}
