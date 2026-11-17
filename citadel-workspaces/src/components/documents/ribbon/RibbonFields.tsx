/**
 * The ribbon's pickers and number fields. A picker shows the caret's value, or an empty "—"
 * entry when that value is not known, never a guess; choosing sends the command at once. A
 * number field commits on Enter or when it loses focus, and only a valid, changed value.
 */
import { useEffect, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { isEnterCommit } from '@/lib/keyboard-commit';
import { cn } from '@/lib/utils';
import { RibbonTip } from './RibbonButton';
import { useRibbon } from './ribbon-context';

const FIELD: string = 'h-[44px] shrink-0 rounded-md border border-input bg-background px-2 text-[14px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

export interface PickerOption {
  readonly value: string;
  readonly label: string;
}

export interface RibbonPickerProps {
  readonly testId: string;
  readonly label: string;
  readonly options: readonly PickerOption[];
  /** The caret's value, or null when it is not known. */
  readonly value: string | null;
  readonly widthPx: number;
  /** Why this picker cannot be used now, beyond the ribbon's own reason. */
  readonly unavailable: string | null;
  readonly onPick: (value: string) => void;
}

const UNKNOWN_VALUE: string = '';

export function RibbonPicker({ testId, label, options, value, widthPx, unavailable, onPick }: RibbonPickerProps): JSX.Element {
  const { disabledReason: ribbonReason } = useRibbon();
  const disabledReason: string | null = ribbonReason ?? unavailable;
  const known: boolean = value !== null && options.some((o: PickerOption): boolean => o.value === value);
  return (
    <RibbonTip label={label} reason={disabledReason}>
      <select
        data-roving-item=""
        data-testid={testId}
        aria-label={label}
        aria-disabled={disabledReason !== null}
        className={cn(FIELD, 'pr-1')}
        style={{ width: widthPx }}
        value={known && value !== null ? value : UNKNOWN_VALUE}
        onChange={(e: ChangeEvent<HTMLSelectElement>): void => {
          if (disabledReason === null && e.target.value !== UNKNOWN_VALUE) onPick(e.target.value);
        }}
      >
        {!known && <option value={UNKNOWN_VALUE}>—</option>}
        {options.map((o: PickerOption): JSX.Element => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </RibbonTip>
  );
}

export interface RibbonNumberFieldProps {
  readonly testId: string;
  readonly label: string;
  /** The short label shown beside the field ("Before"); `label` names it in full. */
  readonly shortLabel: string;
  /** The unit shown after the field ("pt"). */
  readonly unit: string;
  /** The caret's value in that unit, or null when it is not known. */
  readonly value: number | null;
  readonly min: number;
  readonly max: number;
  /** Why this field cannot be set now, beyond the ribbon's own reason. */
  readonly unavailable: string | null;
  readonly onCommit: (value: number) => void;
}

function display(value: number | null): string {
  return value === null ? '' : String(value);
}

/**
 * A value out of range stays in the field, marked invalid with the range beside it, until it
 * is corrected or Escape puts back what the document says.
 */
export function RibbonNumberField({ testId, label, shortLabel, unit, value, min, max, unavailable, onCommit }: RibbonNumberFieldProps): JSX.Element {
  const { disabledReason } = useRibbon();
  const reason: string | null = disabledReason ?? unavailable;
  const [draft, setDraft] = useState<string>(display(value));
  const [refused, setRefused] = useState<boolean>(false);
  useEffect((): void => { setDraft(display(value)); setRefused(false); }, [value]);
  const parsed: number = Number(draft.trim());
  const valid: boolean = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const errorId: string = `${testId}-error`;
  const commit: () => void = (): void => {
    if (reason !== null || draft === display(value)) return;
    if (!valid) { setRefused(true); return; }
    onCommit(parsed);
    // Back to what the caret reports: the field shows the document, never a pending draft.
    setDraft(display(value));
    setRefused(false);
  };
  return (
    <RibbonTip label={`${label} (${min} to ${max} ${unit})`} reason={reason} suppressed={refused}>
      <label className="relative mx-1 inline-flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground">
        <span className="whitespace-nowrap" aria-hidden="true">{shortLabel}</span>
        <input
          type="text"
          inputMode="decimal"
          data-roving-item=""
          data-testid={testId}
          aria-label={`${label}, ${unit}`}
          aria-invalid={refused}
          aria-describedby={refused ? errorId : undefined}
          aria-disabled={reason !== null}
          readOnly={reason !== null}
          placeholder="—"
          className={cn(FIELD, 'w-[64px] text-right aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive')}
          value={draft}
          onChange={(e: ChangeEvent<HTMLInputElement>): void => { setDraft(e.target.value); setRefused(false); }}
          onBlur={(_e: FocusEvent<HTMLInputElement>): void => commit()}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>): void => {
            if (isEnterCommit(e)) { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setDraft(display(value)); setRefused(false); }
          }}
        />
        <span aria-hidden="true">{unit}</span>
        {refused && (
          <span id={errorId} role="alert" data-testid={errorId}
            className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-destructive bg-popover px-2 py-1 text-[12px] text-destructive shadow-md">
            Enter {min} to {max} {unit}.
          </span>
        )}
      </label>
    </RibbonTip>
  );
}
