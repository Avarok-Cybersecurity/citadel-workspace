/**
 * Whether a template will render here, checked before it replaces the user's document.
 *
 * Every shipped template is pinned by every-template-renders.test.tsx, so this is the second line:
 * a template that cannot render -- a future one, or one whose component was since removed -- is
 * refused with its reason instead of silently replacing the document with one that shows "could
 * not be displayed".
 */
import type { MDXComponents } from 'mdx/types';
import { renderMdx } from './render-mdx';

/** Null when the template renders; otherwise why it does not. */
export async function templateRenderProblem(content: string, components: MDXComponents, baseUrl: string): Promise<string | null> {
  try {
    await renderMdx(content, components, baseUrl);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
