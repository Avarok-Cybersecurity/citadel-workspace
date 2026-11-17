/**
 * The public /legal pages. Rendered inside nothing but a router: no session, no agent, no
 * workspace provider, which is what "needs no sign-in" means for a component.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Legal from '../Legal';
import { LEGAL_DOCUMENTS, type LegalDocument } from '@/lib/terms/legal-documents';
import { titleForPath } from '@/components/DocumentTitle';

function at(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/legal/:doc" element={<Legal />} />
        <Route path="/" element={<p>landing</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe.each(LEGAL_DOCUMENTS.map((d: LegalDocument): [string, LegalDocument] => [d.path, d]))('%s', (path: string, doc: LegalDocument) => {
  it('shows its title, effective date and rendered body', () => {
    at(path);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(doc.title);
    expect(screen.getByTestId('legal-facts')).toHaveTextContent(`Effective ${doc.effective}`);
    const body: HTMLElement = screen.getByTestId('legal-markdown');
    expect(body.querySelector('h2, p')).not.toBeNull();
    expect(body.textContent).not.toMatch(/\*\*|^## /m);
    expect(body.querySelector('h1')).toBeNull();
  });

  it('is in the index of five, marked as the current page', () => {
    at(path);
    const nav: HTMLElement = screen.getByRole('navigation', { name: 'Legal documents' });
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
    const current: HTMLElement[] = within(nav).getAllByRole('link').filter((a: HTMLElement): boolean => a.getAttribute('aria-current') === 'page');
    expect(current.map((a: HTMLElement): string | null => a.getAttribute('href'))).toEqual([path]);
  });
});

describe('moving between documents', () => {
  it('the index navigates in place', async () => {
    at('/legal/terms');
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Legal documents' })).getByRole('link', { name: 'Privacy Notice' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy Notice');
  });

  it("a document's own link to another navigates in place rather than leaving the site", async () => {
    at('/legal/privacy');
    const link: HTMLElement = within(screen.getByTestId('legal-markdown')).getAllByRole('link').find((a: HTMLElement): boolean => a.getAttribute('href') === '/legal/subprocessors') as HTMLElement;
    await userEvent.click(link);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Subprocessors');
  });

  it('an unknown document says so and still offers the index', () => {
    at('/legal/nonsense');
    expect(screen.getByTestId('legal-not-found')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Terms of Use/ }).length).toBeGreaterThan(0);
  });
});

describe('printing', () => {
  it('prints the document alone: black on white, without the index or the way back', () => {
    at('/legal/terms');
    expect(document.querySelector('.legal-print')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Legal documents' })).toHaveClass('print:hidden');
    expect(screen.getByRole('link', { name: 'Back to sign in' }).closest('header')).toHaveClass('print:hidden');
  });
});

describe('the tab title', () => {
  it('names the document, not "page not found"', () => {
    expect(titleForPath('/legal/dpa')).toMatch(/^Data Processing Addendum · /);
  });
});
