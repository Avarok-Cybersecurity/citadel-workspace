import { useEffect, useState } from 'react';
import type { CurrentTerms } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { telemetryApi } from '@/lib/telemetry/telemetry-api';
import { describeFailure } from '@/lib/failure-message';

/** The workspace's own terms, shown to every member next to Avarok's. Each change asks members to accept again. */
export function WorkspaceTermsEditor({ canEdit }: { canEdit: boolean }): JSX.Element {
  const [saved, setSaved] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [text, setText] = useState<string>('');
  const [loaded, setLoaded] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [problem, setProblem] = useState<string | null>(null);

  const adopt = (terms: CurrentTerms): void => {
    setSaved(terms.workspace?.text ?? null);
    setVersion(terms.workspace?.version ?? null);
    setText(terms.workspace?.text ?? '');
    setLoaded(true);
  };

  useEffect((): (() => void) => {
    let current: boolean = true;
    telemetryApi.getTerms()
      .then((terms: CurrentTerms): void => { if (current) adopt(terms); })
      .catch((error: unknown): void => { if (current) setProblem(describeFailure(error, 'The workspace terms could not be read.')); });
    return (): void => { current = false; };
  }, []);

  const write = async (next: string | null): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try { adopt(await telemetryApi.setWorkspaceTerms(next)); } catch (error: unknown) { setProblem(describeFailure(error, 'The terms were not saved.')); } finally { setBusy(false); }
  };

  const unchanged: boolean = text.trim() === (saved ?? '');
  return (
    <div className="space-y-2" data-testid="workspace-terms-editor">
      <Label htmlFor="workspace-terms">Workspace terms{version !== null ? ` (version ${version})` : ''}</Label>
      <Textarea id="workspace-terms" rows={5} value={text} disabled={!canEdit || !loaded || busy} onChange={(e) => setText(e.target.value)}
        placeholder="Optional. Members accept these together with Avarok's platform terms." />
      <p className="text-xs text-muted-foreground">Saving a change asks every member to accept the terms again the next time they sign in.</p>
      {problem && <p role="alert" className="text-xs text-destructive-emphasis">{problem}</p>}
      {canEdit && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !loaded || unchanged || text.trim() === ''} onClick={(): void => { void write(text.trim()); }}>Save terms</Button>
          <Button size="sm" variant="outline" disabled={busy || saved === null} onClick={(): void => { void write(null); }}>Remove workspace terms</Button>
        </div>
      )}
    </div>
  );
}
