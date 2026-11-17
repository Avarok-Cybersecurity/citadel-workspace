/**
 * Applying a template to the document being edited: checked first, then applied.
 *
 * Extracted from BaseOffice (file cap). The check is template-check's; a template that would not
 * render is refused with its reason and the document is left as it was.
 */
import { useCallback } from 'react';
import type { MDXComponents } from 'mdx/types';
import type { MdxTemplate } from '@/lib/mdx-templates';
import { useToast } from '@/hooks/use-toast';
import { templateRenderProblem } from './template-check';

export function useApplyTemplate(
  components: MDXComponents,
  setContent: (content: string) => void,
  markNotNew: () => void,
): (template: MdxTemplate) => void {
  const { toast } = useToast();
  return useCallback((template: MdxTemplate): void => {
    void (async (): Promise<void> => {
      const problem: string | null = await templateRenderProblem(template.content, components, window.location.origin);
      if (problem) {
        toast({ title: 'Template not applied', description: `"${template.name}" cannot be displayed here: ${problem}`, variant: 'destructive' });
        return;
      }
      setContent(template.content);
      toast({ title: 'Template applied', description: `Applied "${template.name}" template. You can now customize it.`, variant: 'success' });
      // Content is no longer new once a template is applied.
      markNotNew();
    })();
  }, [components, setContent, markNotNew, toast]);
}
