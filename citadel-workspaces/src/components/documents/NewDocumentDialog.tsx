/**
 * "New document": choose the Citadel App, name the document, and (when the schema permits more
 * than one level here) choose its level. Nothing is preselected: Create stays disabled until the
 * person has picked an app, so no document is ever made in an app nobody chose.
 *
 * The dialog does no I/O. `onCreate` is the write, and its rejection is shown here verbatim.
 */
import { useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getEntityMetadata } from '@/lib/entity-type-registry';
import type { CitadelAppId } from '@/lib/citadel-apps/registry';
import { describeFailure } from '@/lib/failure-message';
import { ChoiceList, type Choice } from './ChoiceList';
import { CitadelAppPicker } from './CitadelAppPicker';
import type { DocumentPlacement } from './document-placement';

export interface NewDocumentInput {
  app: CitadelAppId;
  childType: string;
  name: string;
}

interface NewDocumentDialogProps {
  parentName: string;
  placement: DocumentPlacement;
  onCreate: (input: NewDocumentInput) => Promise<void>;
  onClose: () => void;
}

function levelChoices(types: readonly string[]): Choice[] {
  return types.map((type: string): Choice => {
    const meta: ReturnType<typeof getEntityMetadata> = getEntityMetadata(type);
    return { value: type, label: meta.label, detail: `Created as a ${meta.label.toLowerCase()}`, icon: meta.icon, unavailable: null };
  });
}

export function NewDocumentDialog({ parentName, placement, onCreate, onClose }: NewDocumentDialogProps): JSX.Element {
  const [name, setName] = useState<string>('');
  const [app, setApp] = useState<CitadelAppId | null>(null);
  const [pickedType, setPickedType] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const childType: string | null = placement.kind === 'one' ? placement.type : placement.kind === 'pick' ? pickedType : null;
  const ready: boolean = app !== null && childType !== null && name.trim() !== '' && !submitting;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (app === null || childType === null || name.trim() === '') return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ app, childType, name: name.trim() });
      onClose();
    } catch (failure) {
      setError(describeFailure(failure, 'The document could not be created.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open: boolean): void => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto bg-card border-border" data-testid="new-document-dialog">
        <form onSubmit={(event: FormEvent<HTMLFormElement>): void => { void submit(event); }} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="text-foreground">New document in {parentName}</DialogTitle>
            <DialogDescription className="text-foreground/80">Choose the app it opens in.</DialogDescription>
          </DialogHeader>
          {placement.kind === 'blocked' ? (
            <p role="status" data-testid="new-document-blocked" className="text-sm text-muted-foreground">{placement.reason}</p>
          ) : (
            <>
              <CitadelAppPicker site="workspaceTree" value={app} onChange={setApp} testId="new-document-app" />
              {placement.kind === 'pick' && (
                <ChoiceList legend="Level" choices={levelChoices(placement.types)} value={pickedType} onChange={setPickedType} testId="new-document-level" />
              )}
              <div className="grid gap-2">
                <Label htmlFor="new-document-name">Name</Label>
                <Input
                  id="new-document-name"
                  value={name}
                  onChange={(event): void => setName(event.target.value)}
                  disabled={submitting}
                  required
                  className="min-h-[44px]"
                  data-testid="new-document-name"
                />
              </div>
            </>
          )}
          {error && <p role="alert" data-testid="new-document-error" className="text-sm text-destructive-emphasis">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-[44px]" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" className="min-h-[44px]" disabled={!ready} data-testid="new-document-create">
              {submitting ? 'Creating...' : 'Create document'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
