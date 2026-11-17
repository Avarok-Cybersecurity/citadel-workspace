/**
 * Every shipped MDX template renders against the components the app actually registers.
 *
 * Live (owner, 2026-09-27): choosing the Engineering template showed the old document, and a
 * reload showed "This document could not be displayed. Its content may be malformed." Every
 * template used components that exist nowhere -- <SprintBoard>, <TeamMembers>,
 * <DocumentationList> and thirty-odd more -- and MDX throws for an undefined component the
 * moment the document is rendered.
 *
 * No mocks: the templates, the renderer and the registry are the production ones, and the
 * render goes all the way to markup.
 */
import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { templates } from '../index';
import { components } from '@/components/office/mdxComponents';
import { renderMdx } from '@/components/office/render-mdx';

describe('the MDX templates', () => {
  it('exist', () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  for (const template of templates) {
    it(`renders "${template.name}" (${template.id})`, async () => {
      const element: ReactElement = await renderMdx(template.content, components, 'http://localhost');
      expect(renderToStaticMarkup(element).length).toBeGreaterThan(0);
    });
  }
});
