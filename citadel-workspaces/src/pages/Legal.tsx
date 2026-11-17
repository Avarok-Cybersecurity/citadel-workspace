import type { JSX } from 'react';
import { Link, useNavigate, useParams, type NavigateFunction } from 'react-router-dom';
import { CitadelLogo } from '@/components/brand/CitadelLogo';
import { BRAND_NAME } from '@/components/brand/artwork/brand-rules.generated';
import { LegalLinks } from '@/components/terms/LegalLinks';
import { LegalMarkdown } from '@/components/terms/LegalMarkdown';
import { documentFacts } from '@/components/terms/TermsAcceptanceModal';
import { bodyOf } from '@/lib/terms/legal-text';
import { legalDocument, type LegalDocument } from '@/lib/terms/legal-documents';

/** `/legal/:doc`: a legal document, public (no sign-in, no agent, no workspace). */
export default function Legal(): JSX.Element {
  const { doc: id } = useParams<{ doc: string }>();
  const navigate: NavigateFunction = useNavigate();
  const doc: LegalDocument | undefined = legalDocument(id);
  return (
    <div className="legal-print min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-6 sm:px-6 print:hidden">
        <Link to="/" aria-label={`${BRAND_NAME} home`} className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <CitadelLogo variant="horizontal" height={30} />
        </Link>
        <Link to="/" className="inline-flex min-h-[24px] items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Back to sign in</Link>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-12 pt-8 sm:px-6">
        <LegalLinks current={doc?.id} className="mb-8 print:hidden" />
        {doc === undefined ? (
          <div data-testid="legal-not-found">
            <h1 className="text-2xl font-semibold">That document does not exist</h1>
            <p className="mt-2 text-sm text-muted-foreground">Choose one of the documents above.</p>
          </div>
        ) : (
          <article data-testid="legal-document" aria-labelledby="legal-title">
            <h1 id="legal-title" className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
            <p className="mb-8 mt-2 text-sm text-muted-foreground" data-testid="legal-facts">{documentFacts(doc)}</p>
            <LegalMarkdown text={bodyOf(doc.text)} onOpenDocument={(path: string): void => { void navigate(path); }} />
          </article>
        )}
      </main>
    </div>
  );
}
