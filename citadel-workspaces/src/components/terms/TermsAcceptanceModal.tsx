import { useId, useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { LegalDocument } from '@/lib/terms/legal-documents';
import { bodyOf } from '@/lib/terms/legal-text';
import { LegalMarkdown } from './LegalMarkdown';

export interface TermsAcceptanceModalProps {
  readonly title: string;
  /** Read in tabs when there are several; the first is open. */
  readonly documents: readonly LegalDocument[];
  /** The sentence beside the checkbox. */
  readonly agreement: string;
  readonly onAccept: () => void;
  /** Cancel, Escape and the close button all come here; nothing has been accepted. */
  readonly onCancel: () => void;
}

/** "Version 1 · Effective October 14, 2026", or without the version for documents that have none. */
export function documentFacts(doc: LegalDocument): string {
  return `${doc.version === null ? '' : `Version ${doc.version} · `}Effective ${doc.effective}`;
}

/**
 * Where a person reads Avarok's terms and agrees to them: the one dialog for creating an account
 * and creating a workspace on an Avarok-hosted server. Accept stays disabled until the box is
 * ticked, and the dialog cannot be left by accident with the box ticked and nothing sent.
 */
export function TermsAcceptanceModal({ title, documents, agreement, onAccept, onCancel }: TermsAcceptanceModalProps): JSX.Element {
  const [agreed, setAgreed] = useState<boolean>(false);
  const agreeId: string = useId();
  const first: LegalDocument | undefined = documents[0];
  if (first === undefined) throw new Error('TermsAcceptanceModal needs at least one document');
  return (
    <Dialog open onOpenChange={(open: boolean): void => { if (!open) onCancel(); }}>
      <DialogContent
        data-testid="terms-acceptance-modal"
        className="flex max-h-[min(90dvh,52rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 max-sm:top-[var(--offline-banner-bottom,0px)] max-sm:translate-y-0 max-sm:h-[calc(100dvh-var(--offline-banner-bottom,0px))] max-sm:max-h-[calc(100dvh-var(--offline-banner-bottom,0px))] max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0"
      >
        <Tabs defaultValue={first.id} className="flex min-h-0 flex-1 flex-col">
          <div className="sticky top-0 z-10 space-y-3 border-b border-border bg-background px-5 pb-3 pt-5 pr-12 sm:px-6">
            <div>
              <DialogTitle className="text-lg leading-tight">{title}</DialogTitle>
              <DialogDescription className="mt-1">Read before you continue. Scroll to the end of each document.</DialogDescription>
            </div>
            {documents.length > 1 && (
              <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
                {documents.map((doc: LegalDocument): JSX.Element => (
                  <TabsTrigger key={doc.id} value={doc.id} className="min-h-9 flex-1 sm:flex-none">{doc.title.replace('Citadel Workspace ', '')}</TabsTrigger>
                ))}
              </TabsList>
            )}
          </div>
          {documents.map((doc: LegalDocument): JSX.Element => (
            <TabsContent key={doc.id} value={doc.id} className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6" tabIndex={0}>
              <p className="mb-4 text-xs text-muted-foreground" data-testid="terms-document-facts">{doc.title} · {documentFacts(doc)}</p>
              <LegalMarkdown text={bodyOf(doc.text)} />
            </TabsContent>
          ))}
        </Tabs>
        <div className="space-y-4 border-t border-border bg-background px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <Checkbox id={agreeId} data-testid="terms-agree" checked={agreed}
              onCheckedChange={(on: boolean | 'indeterminate'): void => setAgreed(on === true)} />
            <label htmlFor={agreeId} className="text-sm leading-[24px] text-foreground">{agreement}</label>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" data-testid="terms-cancel" onClick={onCancel}>Cancel</Button>
            <Button type="button" data-testid="terms-accept" disabled={!agreed} onClick={onAccept}>
              Accept and continue
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
