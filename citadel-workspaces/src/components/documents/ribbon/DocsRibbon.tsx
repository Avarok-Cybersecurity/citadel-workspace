/**
 * The Citadel Docs ribbon: Home, Insert and Layout, Word's commands in this app's design.
 * Every control sends one EditorCommand through the editor in EditorControllerContext and
 * hands focus back to the page. There is no ribbon until an editor is provided; with no
 * right to edit, or an IME composition open, every control says why it cannot run. Shortcuts are the editor's: the ribbon only names them.
 */
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { EditorState } from '@/lib/cdoc/editor/controller';
import type { ActionGate } from '@/hooks/use-permission-result';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { CdocFontFaces } from './CdocFontFaces';
import { HomeRibbon } from './HomeRibbon';
import { InsertRibbon } from './InsertRibbon';
import { StoryBar } from './HeaderFooter';
import { LayoutRibbon } from './LayoutRibbon';
import { useEditorController, useEditorState, type RibbonEditor } from './editor-context';
import { RibbonContext, useRibbonValue, type Ribbon } from './ribbon-context';
import type { RibbonEnvironment } from './ribbon-environment';

/** Shown while the engine does not report the caret's formatting, which the toggles then cannot show. */
const UNKNOWN_CARET: string = 'Formatting at the cursor shows once you click or type in the document.';

export type RibbonTab = 'home' | 'insert' | 'layout';

const TABS: readonly { readonly id: RibbonTab; readonly label: string }[] = [
  { id: 'home', label: 'Home' }, { id: 'insert', label: 'Insert' }, { id: 'layout', label: 'Layout' },
];

export interface DocsRibbonProps {
  /** Whether the person may change the document. */
  readonly edit: ActionGate;
  /** The name a new comment is signed with; null until it has loaded. */
  readonly commentAuthor: string | null;
  readonly environment: RibbonEnvironment;
  /** Why a picture cannot be inserted in this document, or null where it can. */
  readonly pictures: string | null;
}

export function DocsRibbon({ edit, commentAuthor, environment, pictures }: DocsRibbonProps): JSX.Element | null {
  const editor: RibbonEditor | null = useEditorController();
  const state: EditorState | null = useEditorState(editor);
  const compact: boolean = useIsMobile();
  const ribbon: Ribbon = useRibbonValue(editor, state, edit, environment, compact);
  const [tab, setTab] = useState<RibbonTab>('home');
  // No ribbon until the editor has opened: controls with nothing to drive would only say so.
  if (editor === null) return null;
  // Where it never moves the toolbar: beside the tabs, or on a phone under the toolbar, where it
  // wraps to its whole text. Mounted empty, so what it says later is announced.
  const status: JSX.Element = (
    <p role="status" data-testid="docs-ribbon-status"
      className={cn('min-w-0 text-[12px] leading-tight text-muted-foreground', compact ? 'min-h-[19px] pt-1' : 'ml-auto text-right')}>
      {ribbon.failure ?? ribbon.notice ?? ribbon.disabledReason ?? (ribbon.caret.known ? '' : UNKNOWN_CARET)}
    </p>
  );
  return (
    <RibbonContext.Provider value={ribbon}>
      <TooltipProvider delayDuration={400}>
        <CdocFontFaces />
        <Tabs value={tab} onValueChange={(next: string): void => setTab(next as RibbonTab)} data-testid="docs-ribbon"
          className="border-b border-border bg-card px-2 pb-1 sm:px-4">
          <div className="flex items-center gap-2">
          <TabsList aria-label="Ribbon" className="h-auto shrink-0 gap-1 bg-transparent p-0 pt-1">
            {TABS.map((t: { id: RibbonTab; label: string }): JSX.Element => (
              <TabsTrigger key={t.id} value={t.id} data-testid={`docs-ribbon-tab-${t.id}`}
                className="h-[44px] rounded-b-none border-b-2 border-transparent px-4 data-[state=active]:border-primary data-[state=active]:shadow-none">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {!compact && status}
          </div>
          <TabsContent value="home" tabIndex={-1} className="mt-1"><HomeRibbon /></TabsContent>
          <TabsContent value="insert" tabIndex={-1} className="mt-1"><InsertRibbon commentAuthor={commentAuthor} pictures={pictures} /></TabsContent>
          <TabsContent value="layout" tabIndex={-1} className="mt-1"><LayoutRibbon /></TabsContent>
          <StoryBar />
          {compact && status}
        </Tabs>
      </TooltipProvider>
    </RibbonContext.Provider>
  );
}
