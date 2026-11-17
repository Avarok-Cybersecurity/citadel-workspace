/**
 * A page saved straight from a template that shipped broken is offered the fixed template.
 *
 * Documents saved from the old templates (components that exist nowhere) stay broken after the
 * templates are fixed: they hold the old body. Such a page is byte-identical to that body, so its
 * stored hash names the template, and someone who may edit is offered the fixed version. A page
 * the user edited has a different hash and is left alone.
 *
 * No mocks: the error view, the hash map and the real hashing of the real old bodies' hashes.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentRenderError } from '../DocumentRenderError';
import { SUPERSEDED_TEMPLATE_HASHES, supersededTemplateId } from '@/lib/mdx-templates/superseded';
import { getTemplateById } from '@/lib/mdx-templates';

const ENGINEERING_OLD_HASH: string = '72b14310a94e0ea3568aa013c5ae8df678917ebd424fb901213fd66bc549942f';

describe('the superseded-template map', () => {
  it('names a template that still exists, for every recorded hash', () => {
    for (const id of Object.values(SUPERSEDED_TEMPLATE_HASHES)) expect(getTemplateById(id), id).toBeDefined();
  });

  it('recognises the unedited Engineering copy and nothing else', () => {
    expect(supersededTemplateId(ENGINEERING_OLD_HASH)).toBe('office-engineering');
    expect(supersededTemplateId('0'.repeat(64))).toBeUndefined();
    expect(supersededTemplateId(null)).toBeUndefined();
  });
});

describe('a page that cannot be displayed', () => {
  it('offers an editor the fixed template, and hands it over on press', () => {
    const onReplace: ReturnType<typeof vi.fn> = vi.fn();
    render(<DocumentRenderError message="could not be displayed" storedHash={ENGINEERING_OLD_HASH} canEdit onReplace={onReplace} />);
    fireEvent.click(screen.getByTestId('replace-with-fixed-template'));
    expect(onReplace).toHaveBeenCalledWith(getTemplateById('office-engineering'));
  });

  it('offers nothing to someone who may not edit', () => {
    render(<DocumentRenderError message="could not be displayed" storedHash={ENGINEERING_OLD_HASH} canEdit={false} onReplace={vi.fn()} />);
    expect(screen.queryByTestId('replace-with-fixed-template')).toBeNull();
  });

  it('offers nothing for a page the user edited (a different hash)', () => {
    render(<DocumentRenderError message="could not be displayed" storedHash={'1'.repeat(64)} canEdit onReplace={vi.fn()} />);
    expect(screen.queryByTestId('replace-with-fixed-template')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('could not be displayed');
  });
});
