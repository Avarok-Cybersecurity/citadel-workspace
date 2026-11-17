/**
 * The title bar's save controls for an open document, Word-style: where the edits are (the one
 * place the status is shown, SaveIndicator), what can be done about it (Try again when this
 * device's copy could not be written; Sync or Discard while copies kept here are locked), the
 * AutoSave switch, the account's "Encrypt on this device" switch, and Save. Everything whose width
 * changes with the state sits left of the switches, and the group is anchored right, so a change
 * of state never moves a control. Closing the page warns only while some edits are neither
 * acknowledged nor yet written to this device. Nothing renders until the session is open.
 */
import { useEffect, useId, useSyncExternalStore, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { useIsMobile } from '@/hooks/use-mobile';
import { canSave, saveStatus, warnsOnUnload, type SaveInputs, type SaveStatus } from '@/lib/document-save/save-status';
import { RETRY_DEVICE_WRITE_TEXT } from '@/lib/document-save/save-status-text';
import type { SaveIndicatorTiming } from '@/lib/document-save/visible-save-state';
import { useVisibleSave } from './use-visible-save';
import type { Clock } from '@/lib/cdoc/collab/ports';
import type { SaveControl } from './save-control';
import { SaveIndicator, SaveStatusLine, wordsOnTheirOwnRow } from './SaveIndicator';
import { AtRestSwitch } from './AtRestSwitch';
import { LockedCopiesActions } from './LockedCopiesActions';

const useInputs = (control: SaveControl): SaveInputs | null => useSyncExternalStore(control.inputs.subscribe, control.inputs.get);

/** A refusal is the session's to report (as a notice); this is only an action that could not start. */
function attempt(action: Promise<void>, what: string): void {
  action.catch((error: unknown): void => { toast.error(`Could not ${what}. ${error instanceof Error ? error.message : String(error)}`); });
}

const ACTION: string = 'min-h-[44px] rounded-md border border-border px-[12px] text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';

interface DocumentSaveControlsProps {
  readonly control: SaveControl;
  /** What the status's timing runs on (visible-save-state.ts). */
  readonly clock: Clock;
  readonly timing: SaveIndicatorTiming;
}

export function DocumentSaveControls({ control, clock, timing }: DocumentSaveControlsProps): JSX.Element | null {
  const inputs: SaveInputs | null = useInputs(control);
  const switchId: string = useId();
  const compact: boolean = useIsMobile();
  const warns: boolean = inputs !== null && warnsOnUnload(inputs);
  useEffect((): (() => void) | undefined => {
    if (!warns) return undefined;
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return (): void => window.removeEventListener('beforeunload', warn);
  }, [warns]);
  if (inputs === null) return null;
  return <LoadedControls control={control} inputs={inputs} clock={clock} timing={timing} compact={compact} switchId={switchId} />;
}

interface LoadedProps extends DocumentSaveControlsProps {
  readonly inputs: SaveInputs;
  readonly compact: boolean;
  readonly switchId: string;
}

function LoadedControls({ control, inputs, clock, timing, compact, switchId }: LoadedProps): JSX.Element {
  const status: SaveStatus = saveStatus(inputs);
  const shown: SaveStatus = useVisibleSave(status, clock, timing);
  const account: bigint | null = control.account();
  const actions: JSX.Element | null = status === 'locked'
    ? <LockedCopiesActions control={control} linkUp={inputs.link === 'up'} />
    : status === 'unsavedOnDevice' && inputs.local === 'failed'
      ? (
        <button type="button" data-testid="docs-save-retry" onClick={(): void => attempt(control.keepAgain(), 'keep a copy on this device')} className={ACTION}>
          {RETRY_DEVICE_WRITE_TEXT}
        </button>
      )
      : null;
  return (
    <>
      <div className="ml-auto flex shrink-0 items-center gap-[12px]" data-testid="docs-save-controls">
        {!compact && actions}
        <SaveIndicator shown={shown} compact={compact} />
        <div className="flex items-center gap-[8px]">
          <Switch id={switchId} checked={inputs.autoSave} data-testid="docs-autosave" onCheckedChange={(on: boolean): void => attempt(control.setAutoSave(on), 'change AutoSave')} />
          <label htmlFor={switchId} className="text-sm text-foreground">AutoSave</label>
        </div>
        {account !== null && <AtRestSwitch account={account} place="titleBar" />}
        <button
          type="button"
          data-testid="docs-save"
          disabled={!canSave(inputs)}
          onClick={(): void => attempt(control.save(), 'save')}
          className={`min-w-[44px] ${ACTION}`}
        >
          Save
        </button>
      </div>
      {/* A phone has no room beside the title for the state's words or what it offers: they take a row of
          their own under the title bar's (which wraps), and the controls above stay where they were. */}
      {wordsOnTheirOwnRow(shown, compact) && (
        <div className="order-last flex basis-full items-center justify-end gap-[12px]" data-testid="docs-save-row">
          <SaveStatusLine shown={shown} />
          {actions !== null && <div className="flex gap-[12px]" data-testid="docs-save-actions">{actions}</div>}
        </div>
      )}
    </>
  );
}

/**
 * Ctrl/Cmd+S over the document region (not the window, so other screens keep their keys):
 * Save, and never the browser's "save page". Bound on capture, ahead of the editor's own keys.
 */
export function saveShortcut(control: SaveControl | null): ((event: KeyboardEvent<HTMLElement>) => void) | undefined {
  if (control === null) return undefined;
  return (event: KeyboardEvent<HTMLElement>): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    const inputs: SaveInputs | null = control.inputs.get();
    if (inputs !== null && canSave(inputs)) attempt(control.save(), 'save');
  };
}
