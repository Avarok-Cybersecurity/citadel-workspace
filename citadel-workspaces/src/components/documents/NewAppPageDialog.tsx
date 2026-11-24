/**
 * "New app page": a node whose page is an installed app (node-page-abi.md §3). The person picks
 * one of the installs that may be a page here (page-candidates.ts), names the node, and (when the
 * schema permits several levels here) picks its level. Nothing is preselected: Create stays
 * disabled until an app is chosen. With no install that may be a page here, the dialog says so
 * and offers the Apps marketplace instead of an empty list.
 *
 * The dialog does no I/O. `onCreate` is the write, and its rejection is shown here verbatim.
 */
import { useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { installedAppIcon } from '@/components/citadel-apps/InstalledAppIcon';
import type { PageCandidate, PageCandidates } from '@/lib/citadel-apps/page-candidates';
import { describeFailure } from '@/lib/failure-message';
import { ChoiceList, type Choice } from './ChoiceList';
import { levelChoices } from './level-choices';
import type { DocumentPlacement } from './document-placement';

export interface NewAppPageInput {
  candidate: PageCandidate;
  childType: string;
  name: string;
}

interface NewAppPageDialogProps {
  parentName: string;
  placement: DocumentPlacement;
  candidates: PageCandidates;
  onCreate: (input: NewAppPageInput) => Promise<void>;
  onOpenApps: () => void;
  onClose: () => void;
}

const scopeDetail = (c: PageCandidate): string =>
  `${c.app.manifest.summary} · ${c.install.scope === 'Workspace' ? 'Installed for the whole workspace' : 'Installed for this part of the tree'}`;

const appChoices = (candidates: readonly PageCandidate[]): Choice[] => candidates.map((c: PageCandidate): Choice => (
  { value: c.install.id, label: c.app.manifest.name, detail: scopeDetail(c), icon: installedAppIcon(c.app.manifest.id), unavailable: null }
));

function Candidates({ candidates, value, onChange, onOpenApps }: { candidates: PageCandidates; value: string | null; onChange: (id: string) => void; onOpenApps: () => void }): JSX.Element {
  if (candidates.kind === 'loading') return <p role="status" className="text-sm text-muted-foreground">Looking for apps that can be a page here…</p>;
  if (candidates.kind === 'failed') return <p role="alert" data-testid="new-app-page-unavailable" className="text-sm text-destructive-emphasis">{candidates.why}</p>;
  if (candidates.candidates.length === 0) {
    return (
      <div role="status" data-testid="new-app-page-empty" className="grid gap-2 text-sm text-muted-foreground">
        <p>No app installed here can be a page. A page needs an app made for pages, installed for the whole workspace or for this part of the tree.</p>
        <Button type="button" variant="outline" className="min-h-[44px] justify-self-start" onClick={onOpenApps} data-testid="new-app-page-open-apps">Browse apps</Button>
      </div>
    );
  }
  return <ChoiceList legend="App" choices={appChoices(candidates.candidates)} value={value} onChange={onChange} testId="new-app-page-app" />;
}

export function NewAppPageDialog({ parentName, placement, candidates, onCreate, onOpenApps, onClose }: NewAppPageDialogProps): JSX.Element {
  const [name, setName] = useState<string>('');
  const [installId, setInstallId] = useState<string | null>(null);
  const [pickedType, setPickedType] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const candidate: PageCandidate | undefined = candidates.kind === 'ready' ? candidates.candidates.find((c: PageCandidate) => c.install.id === installId) : undefined;
  const childType: string | null = placement.kind === 'one' ? placement.type : placement.kind === 'pick' ? pickedType : null;
  const ready: boolean = candidate !== undefined && childType !== null && name.trim() !== '' && !submitting;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (candidate === undefined || childType === null || name.trim() === '') return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ candidate, childType, name: name.trim() });
      onClose();
    } catch (failure) {
      setError(describeFailure(failure, 'The page could not be created.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open: boolean): void => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto bg-card border-border" data-testid="new-app-page-dialog">
        <form onSubmit={(event: FormEvent<HTMLFormElement>): void => { void submit(event); }} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="text-foreground">New app page in {parentName}</DialogTitle>
            <DialogDescription className="text-foreground/80">Choose the installed app this page shows.</DialogDescription>
          </DialogHeader>
          {placement.kind === 'blocked' ? (
            <p role="status" data-testid="new-app-page-blocked" className="text-sm text-muted-foreground">{placement.reason}</p>
          ) : (
            <>
              <Candidates candidates={candidates} value={installId} onChange={setInstallId} onOpenApps={onOpenApps} />
              {placement.kind === 'pick' && (
                <ChoiceList legend="Level" choices={levelChoices(placement.types)} value={pickedType} onChange={setPickedType} testId="new-app-page-level" />
              )}
              <div className="grid gap-2">
                <Label htmlFor="new-app-page-name">Name</Label>
                <Input id="new-app-page-name" value={name} onChange={(event): void => setName(event.target.value)} disabled={submitting} required className="min-h-[44px]" data-testid="new-app-page-name" />
              </div>
            </>
          )}
          {error && <p role="alert" data-testid="new-app-page-error" className="text-sm text-destructive-emphasis">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-[44px]" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" className="min-h-[44px]" disabled={!ready} data-testid="new-app-page-create">
              {submitting ? 'Creating...' : 'Create page'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
