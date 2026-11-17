/**
 * The dialog where terms are read and accepted. No doubles: the real dialog primitives, tabs and
 * Markdown renderer, with the real bundled documents.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TermsAcceptanceModal, documentFacts } from '../TermsAcceptanceModal';
import { CUSTOMER_TERMS_DOCUMENT, PLATFORM_TERMS_DOCUMENT, legalDocument, type LegalDocument } from '@/lib/terms/legal-documents';

function open(documents: LegalDocument[] = [PLATFORM_TERMS_DOCUMENT]): { accept: Mock; cancel: Mock } {
  const accept: Mock = vi.fn();
  const cancel: Mock = vi.fn();
  render(<TermsAcceptanceModal title="Terms of Use" documents={documents} agreement="I agree." onAccept={accept} onCancel={cancel} />);
  return { accept, cancel };
}

describe('accepting', () => {
  it('is disabled until the box is ticked, and un-ticking disables it again', () => {
    const { accept } = open();
    expect(screen.getByTestId('terms-accept')).toBeDisabled();
    fireEvent.click(screen.getByTestId('terms-agree'));
    expect(screen.getByTestId('terms-accept')).toBeEnabled();
    fireEvent.click(screen.getByTestId('terms-agree'));
    expect(screen.getByTestId('terms-accept')).toBeDisabled();
    expect(accept).not.toHaveBeenCalled();
  });

  it('accepts once the box is ticked', () => {
    const { accept, cancel } = open();
    fireEvent.click(screen.getByTestId('terms-agree'));
    fireEvent.click(screen.getByTestId('terms-accept'));
    expect(accept).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('leaving without accepting', () => {
  it('Cancel and Escape both cancel and accept nothing, ticked or not', async () => {
    const { accept, cancel } = open();
    fireEvent.click(screen.getByTestId('terms-agree'));
    fireEvent.click(screen.getByTestId('terms-cancel'));
    await userEvent.keyboard('{Escape}');
    expect(cancel).toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });
});

describe('the document', () => {
  it('is a labelled dialog that states its title, version and effective date', () => {
    open();
    const dialog: HTMLElement = screen.getByRole('dialog', { name: 'Terms of Use' });
    expect(within(dialog).getByTestId('terms-document-facts')).toHaveTextContent(documentFacts(PLATFORM_TERMS_DOCUMENT));
    expect(documentFacts(PLATFORM_TERMS_DOCUMENT)).toMatch(/^Version 3 · Effective October 23, 2026$/);
  });

  it('is rendered as Markdown: headings, lists and bold, not asterisks and hashes', () => {
    open();
    const body: HTMLElement = screen.getByTestId('legal-markdown');
    expect(body.querySelectorAll('h2').length).toBeGreaterThan(3);
    expect(body.querySelector('ol li, ul li')).not.toBeNull();
    expect(body.querySelector('strong')).not.toBeNull();
    expect(body.textContent).not.toMatch(/^#{1,3} |\*\*/m);
  });

  it('opens its own-document links in a new tab, never over the reader', () => {
    open([CUSTOMER_TERMS_DOCUMENT]);
    const link: HTMLElement = screen.getAllByRole('link').find((a: HTMLElement): boolean => a.getAttribute('href') === '/legal/subprocessors') as HTMLElement;
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('opens mail links in the mail client, without leaving an empty tab', () => {
    open();
    const mail: HTMLElement[] = screen.getAllByRole('link').filter((a: HTMLElement): boolean => a.getAttribute('href')?.startsWith('mailto:') ?? false);
    expect(mail.length).toBeGreaterThan(0);
    for (const link of mail) expect(link).not.toHaveAttribute('target');
  });

  it('puts a table in its own scroll box, so a wide one cannot push the page sideways', () => {
    open([legalDocument('subprocessors') as LegalDocument]);
    const table: HTMLTableElement | null = screen.getByTestId('legal-markdown').querySelector('table');
    expect(table?.parentElement).toHaveAttribute('data-testid', 'legal-table-scroll');
  });
});

describe('two documents', () => {
  it('are read in tabs, the first open; one document has no tabs', async () => {
    open([CUSTOMER_TERMS_DOCUMENT, PLATFORM_TERMS_DOCUMENT]);
    const tabs: HTMLElement[] = screen.getAllByRole('tab');
    expect(tabs.map((t: HTMLElement): string | null => t.textContent)).toEqual(['Customer Terms', 'Terms of Use']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tabs[1]);
    expect(screen.getByTestId('terms-document-facts')).toHaveTextContent('Terms of Use');
  });

  it('a single document has none', () => {
    open();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});
