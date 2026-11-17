/**
 * Compile and render an MDX document against the office component registry.
 *
 * One function for every place a document is turned into React: the office view
 * (use-compiled-mdx), the template picker's pre-check, and the test that every shipped template
 * renders. Calling the compiled document with the registry is what throws for a component the
 * registry does not define ("Expected component `SprintBoard` to be defined"), so a caller that
 * gets an element back has a document that will display.
 */
import type { ReactElement } from 'react';
import type { MDXComponents } from 'mdx/types';
import { evaluate } from '@mdx-js/mdx';
import * as runtime from 'react/jsx-runtime';
import remarkGfm from 'remark-gfm';
import { applyGfmStrikethrough } from './mdx-preprocess';

export async function renderMdx(content: string, components: MDXComponents, baseUrl: string): Promise<ReactElement> {
  // remark-gfm handles strikethrough, tables, autolinks, task-lists. The pre-pass escapes
  // JSX-significant characters inside `~~...~~` so `~~value < 5~~` survives MDX parsing.
  const result: Awaited<ReturnType<typeof evaluate>> = await evaluate(applyGfmStrikethrough(content), {
    ...runtime,
    remarkPlugins: [remarkGfm],
    useMDXComponents: () => components,
    baseUrl,
  });
  return result.default({ components }) as ReactElement;
}
