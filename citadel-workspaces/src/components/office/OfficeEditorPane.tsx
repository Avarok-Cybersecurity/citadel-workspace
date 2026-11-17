/**
 * The office document's editor. The editing buffer is the document's BODY: a required-apps header
 * on its first line (lib/citadel-apps/md-header.ts) is taken off before the text reaches the
 * editor and put back, byte for byte, on every change, so nobody sees it or deletes it by accident.
 * `content` stays the full stored string, which is what is saved and what the hash is over.
 */
import { MDXEditor } from '@/components/mdx/MDXEditor';
import TemplateSelector from '@/components/mdx/TemplateSelector';
import type { MdxTemplate, TemplateCategory } from '@/lib/mdx-templates';
import type { NodeEntityType } from '@/lib/entity-type-registry';
import { joinHeader, splitHeader, type SplitDocument } from '@/lib/citadel-apps/md-header';

interface OfficeEditorPaneProps {
  content: string;
  setContent: (content: string) => void;
  isNewContent: boolean;
  templateCategory: TemplateCategory | null;
  level: NodeEntityType;
  onSelectTemplate: (template: MdxTemplate) => void;
}

export function OfficeEditorPane({ content, setContent, isNewContent, templateCategory, level, onSelectTemplate }: OfficeEditorPaneProps): JSX.Element {
  const { header, body }: SplitDocument = splitHeader(content);
  return (
    <div className="px-6 lg:px-10 pt-8 pb-4 max-w-4xl">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-foreground">Edit Content</h2>
        <div className="flex gap-2">
          {templateCategory && (isNewContent || body.trim() === '') && (
            <TemplateSelector
              category={templateCategory}
              level={level}
              onSelectTemplate={onSelectTemplate}
              buttonVariant="outline"
              buttonSize="sm"
              buttonText="Use Template"
            />
          )}
        </div>
      </div>
      <MDXEditor
        value={body}
        onChange={(value: string) => setContent(joinHeader(header, value))}
        height="400px"
        placeholder="Write your office content here using Markdown or MDX..."
      />
    </div>
  );
}
