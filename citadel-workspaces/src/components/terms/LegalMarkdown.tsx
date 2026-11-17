import type { JSX, MouseEvent, ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { legalDocument } from '@/lib/terms/legal-documents';
import { TENANT_DOMAIN } from '@/lib/onboarding/slug';

export interface LegalMarkdownProps {
  /** Markdown, rendered as written. A bundled document's own header is the caller's to strip (`bodyOf`). */
  readonly text: string;
  /**
   * Where a link to another legal document goes. Given, the page navigates in place; absent (a
   * dialog sitting over something the reader is in the middle of), it opens in a new tab.
   */
  readonly onOpenDocument?: (path: string) => void;
}

const DOCUMENT_URL: RegExp = new RegExp(`^https://${TENANT_DOMAIN.replace(/\./g, '\\.')}/legal/([a-z-]+)/?$`);

/** The in-app path of a link the documents make to one of themselves, else `undefined`. */
export function ownDocumentPath(href: string): string | undefined {
  return legalDocument(DOCUMENT_URL.exec(href)?.[1])?.path;
}

function anchorFor(onOpenDocument: LegalMarkdownProps['onOpenDocument']): Components['a'] {
  return function LegalAnchor({ href, children }: { href?: string; children?: ReactNode }): JSX.Element {
    const own: string | undefined = href === undefined ? undefined : ownDocumentPath(href);
    if (own !== undefined && onOpenDocument !== undefined) {
      return (
        <a href={own} onClick={(event: MouseEvent<HTMLAnchorElement>): void => { event.preventDefault(); onOpenDocument(own); }}>
          {children}
        </a>
      );
    }
    // A mail link opens the mail client; a new tab for it is only an empty tab left behind.
    if (href?.startsWith('mailto:')) return <a href={href}>{children}</a>;
    return <a href={own ?? href} target="_blank" rel="noopener noreferrer">{children}</a>;
  };
}

/** A table scrolls inside itself at phone width rather than pushing the page sideways. */
function LegalTable({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <div className="overflow-x-auto" data-testid="legal-table-scroll">
      <table>{children}</table>
    </div>
  );
}

/**
 * The one renderer of the legal documents: the acceptance dialog, the read-only dialogs, the
 * re-acceptance prompt and the public /legal pages all come through here, so a document reads the
 * same wherever it is shown. Markdown only: raw HTML in the text is never interpreted.
 */
export function LegalMarkdown({ text, onOpenDocument }: LegalMarkdownProps): JSX.Element {
  return (
    <div
      data-testid="legal-markdown"
      className="prose prose-sm sm:prose-base max-w-[68ch] break-words prose-headings:text-foreground prose-headings:scroll-mt-4 prose-h2:mt-8 prose-strong:text-foreground prose-li:text-foreground prose-a:underline prose-a:underline-offset-2"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: anchorFor(onOpenDocument), table: LegalTable }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
