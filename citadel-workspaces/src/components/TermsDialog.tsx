import { LegalMarkdown } from '@/components/terms/LegalMarkdown';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface TermsText {
  heading: string;
  version: number;
  text: string;
  /** Avarok's own documents are Markdown; a workspace's terms are plain text, never interpreted. */
  markdown?: boolean;
}

interface TermsDialogProps {
  documents: readonly TermsText[];
  onClose: () => void;
}

/** Reads terms, as written. */
export function TermsDialog({ documents, onClose }: TermsDialogProps): JSX.Element {
  return (
    <Dialog open onOpenChange={(open: boolean): void => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="terms-dialog">
        <DialogHeader>
          <DialogTitle>Terms</DialogTitle>
          <DialogDescription>What you agree to when you join.</DialogDescription>
        </DialogHeader>
        <TermsSections documents={documents} />
      </DialogContent>
    </Dialog>
  );
}

/** The terms as written, one titled section each. */
export function TermsSections({ documents }: { documents: readonly TermsText[] }): JSX.Element {
  return (
    <>
      {documents.map((doc: TermsText): JSX.Element => (
        <section key={doc.heading} aria-label={doc.heading} className="space-y-1">
          <h3 className="text-sm font-semibold">{doc.heading} <span className="font-normal text-muted-foreground">(version {doc.version})</span></h3>
          {doc.markdown === true
            ? <LegalMarkdown text={doc.text} />
            : <p className="whitespace-pre-wrap text-sm text-muted-foreground">{doc.text}</p>}
        </section>
      ))}
    </>
  );
}
