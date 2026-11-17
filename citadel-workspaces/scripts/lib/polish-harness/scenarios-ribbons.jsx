/**
 * The Citadel Docs ribbon, unmodified, over the FakeEditor its unit tests use (a browser
 * page with no cdoc worker). `docs-ribbon` reports a
 * known caret (a Heading 1 run, so pressed states and the gallery's current style draw);
 * `docs-ribbon-unknown` reports none, as a replica does before its first result.
 */
import { useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { DocsRibbon } from '@/components/documents/ribbon/DocsRibbon';
import { EditorControllerContext } from '@/components/documents/ribbon/editor-context';
import { browserRibbonEnvironment } from '@/components/documents/ribbon/ribbon-environment';
import { FakeEditor, knownCaret } from '@/components/documents/ribbon/__tests__/fake-editor';

const KNOWN = knownCaret(
  { bold: true, font: 'Calibri Light', size: 32, color: '#2F5496' },
  { style: 'Heading1', alignment: 'left', spacing: { before: 1200, after: 0 } },
);

/** A refusal as long as the engine's longest, for the phone layout to hold in one line. */
const LONG_REFUSAL = 'the selection spans a table and the text around it, and this command applies to one or the other but not both at once';

function Ribbon({ caret, refusing = false }) {
  const [editor] = useState(() => {
    const fake = new FakeEditor(caret);
    if (refusing) fake.refuseNext(LONG_REFUSAL);
    return fake;
  });
  return (
    <EditorControllerContext.Provider value={editor}>
      <div className="flex h-screen flex-col bg-background">
        <DocsRibbon edit={{ enabled: true, reason: null }} commentAuthor="Ada Lovelace" environment={browserRibbonEnvironment()} />
        <div className="flex-1 bg-muted" data-testid="ribbon-page-stand-in" />
      </div>
      <Toaster />
    </EditorControllerContext.Provider>
  );
}

export const RIBBON_SCENARIOS = {
  'docs-ribbon': () => <Ribbon caret={KNOWN} />,
  'docs-ribbon-unknown': () => <Ribbon caret={{ known: false }} />,
  // The first command is refused with a long reason (statusNeverMovesTheToolbar).
  'docs-ribbon-refusing': () => <Ribbon caret={KNOWN} refusing />,
};
