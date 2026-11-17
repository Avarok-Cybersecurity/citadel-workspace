/**
 * What a document that cannot render shows in place of its body.
 *
 * Extracted from BaseOffice (file cap). For an unedited copy of a template that shipped broken
 * (lib/mdx-templates/superseded), someone who may edit the page is offered the fixed template: it
 * is loaded into the editor, and nothing is saved until they save it.
 */
import { Button } from '@/components/ui/button';
import { getTemplateById, type MdxTemplate } from '@/lib/mdx-templates';
import { supersededTemplateId } from '@/lib/mdx-templates/superseded';

interface DocumentRenderErrorProps {
  message: string;
  storedHash: string | null | undefined;
  canEdit: boolean;
  onReplace: (template: MdxTemplate) => void;
}

export function DocumentRenderError({ message, storedHash, canEdit, onReplace }: DocumentRenderErrorProps): JSX.Element {
  const id: string | undefined = supersededTemplateId(storedHash);
  const fixed: MdxTemplate | undefined = id ? getTemplateById(id) : undefined;
  return (
    <div className="not-prose space-y-3">
      <p role="alert" className="text-destructive-emphasis">{message}</p>
      {fixed && canEdit && (
        <>
          <p className="text-sm text-muted-foreground">
            This page is an unedited copy of the &ldquo;{fixed.name}&rdquo; template, which has since been fixed.
          </p>
          <Button type="button" data-testid="replace-with-fixed-template" onClick={(): void => onReplace(fixed)}>
            Replace with the fixed template
          </Button>
        </>
      )}
    </div>
  );
}
