import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { LEGAL_DOCUMENT_IDS, LEGAL_SHORT_NAME, legalPath, type LegalDocumentId } from '@/lib/terms/legal-index';

/** The five documents, as links between the public pages. `current` is marked for assistive tech. */
export function LegalLinks({ current, className }: { readonly current?: LegalDocumentId; readonly className?: string }): JSX.Element {
  return (
    <nav aria-label="Legal documents" className={className}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {LEGAL_DOCUMENT_IDS.map((id: LegalDocumentId): JSX.Element => (
          <li key={id}>
            <Link
              to={legalPath(id)}
              aria-current={id === current ? 'page' : undefined}
              className={cn('inline-flex min-h-[24px] items-center text-sm underline-offset-4 hover:underline', id === current ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {LEGAL_SHORT_NAME[id]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
