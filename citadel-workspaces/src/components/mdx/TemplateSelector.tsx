import { useState, useEffect , type ComponentType } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, FileText } from 'lucide-react';
import { getEntityMetadata, type EntityTypeMetadata, type NodeEntityType } from '@/lib/entity-type-registry';
import { activateOnKey } from '@/lib/a11y';

import {
  TemplateCategory,
  MdxTemplate,
  getTemplatesByCategory
} from '@/lib/mdx-templates';

interface TemplateSelectorProps {
  category: TemplateCategory;
  /** The node's own level, whose schema label and icon the dialog shows. */
  level: NodeEntityType;
  onSelectTemplate: (template: MdxTemplate) => void;
  buttonVariant?: 'default' | 'outline' | 'secondary' | 'ghost';
  buttonSize?: 'default' | 'sm' | 'lg' | 'icon';
  buttonText?: string;
}

const TemplateSelector = ({
  category,
  level,
  onSelectTemplate,
  buttonVariant = 'default',
  buttonSize = 'default',
  buttonText = 'Select Template'
}: TemplateSelectorProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MdxTemplate | null>(null);
  const [templates, setTemplates] = useState<MdxTemplate[]>([]);

  // Fetch templates by category when opened
  useEffect(() => {
    if (open) {
      const categoryTemplates: MdxTemplate[] = getTemplatesByCategory(category);
      setTemplates(categoryTemplates);
      setSelectedTemplate(null);
    }
  }, [open, category]);

  const handleSelectTemplate = (): void => {
    if (selectedTemplate) {
      onSelectTemplate(selectedTemplate);
      setOpen(false);
    }
  };

  // The node's level as the live schema names it; never derived from the category.
  const metadata: EntityTypeMetadata = getEntityMetadata(level);
  const CategoryIcon: ComponentType<{ className?: string; }> = metadata.icon;
  const categoryLabel: string = metadata.label;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={buttonVariant}
          size={buttonSize}
          className="gap-2"
        >
          <FileText size={16} />
          {buttonText}
        </Button>
      </DialogTrigger>

      <DialogContent className="w-full max-w-3xl bg-card text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CategoryIcon className="h-[18px] w-[18px]" />
            {categoryLabel} Templates
          </DialogTitle>
          <DialogDescription className="text-foreground/80">
            Choose a template to start this {categoryLabel.toLowerCase()} with pre-configured content.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Tabs defaultValue="gallery" className="w-full">
            <TabsList className="grid grid-cols-2 mb-4 bg-card">
              <TabsTrigger value="gallery" className="data-[state=active]:bg-surface data-[state=active]:text-foreground">
                Gallery View
              </TabsTrigger>
              <TabsTrigger value="list" className="data-[state=active]:bg-surface data-[state=active]:text-foreground">
                List View
              </TabsTrigger>
            </TabsList>

            <TabsContent value="gallery" className="mt-0">
              <ScrollArea className="h-[400px] pr-4">
                <div className="grid grid-cols-2 gap-4">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className={`relative rounded-md overflow-hidden border-2 transition-all cursor-pointer
                        ${selectedTemplate?.id === template.id
                          ? 'border-primary-accent shadow-lg shadow-primary/30'
                          : 'border-border hover:border-border'
                        }`}
                      onClick={() => setSelectedTemplate(template)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={activateOnKey((): void => { ((): void => setSelectedTemplate(template))(); })}
                    >
                      <div className="absolute top-2 right-2 z-10">
                        {selectedTemplate?.id === template.id && (
                          <div className="rounded-full bg-primary p-1">
                            <Check size={16} />
                          </div>
                        )}
                      </div>

                      <div className="h-32 bg-surface flex items-center justify-center">
                        {template.thumbnail ? (
                          <img
                            src={template.thumbnail}
                            alt={template.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-muted-foreground">
                            <CategoryIcon className="h-12 w-12" />
                            <span className="text-xs mt-2">{template.type.toString().replace('_', ' ')}</span>
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <h3 className="font-medium text-sm">{template.name}</h3>
                        <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="list" className="mt-0">
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className={`flex items-start p-3 rounded-md transition-all cursor-pointer
                        ${selectedTemplate?.id === template.id
                          ? 'bg-primary/20 border-l-4 border-primary-accent'
                          : 'hover:bg-card'
                        }`}
                      onClick={() => setSelectedTemplate(template)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={activateOnKey((): void => { ((): void => setSelectedTemplate(template))(); })}
                    >
                      <div className="mr-3 mt-1">
                        <CategoryIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-medium text-sm">{template.name}</h3>
                        <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                      </div>
                      {selectedTemplate?.id === template.id && (
                        <div className="rounded-full bg-primary p-1 ml-2">
                          <Check size={16} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            className="border-border text-foreground/80 hover:bg-accent"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSelectTemplate}
            disabled={!selectedTemplate}
            className="bg-primary hover:bg-primary/90"
          >
            Use Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateSelector;
