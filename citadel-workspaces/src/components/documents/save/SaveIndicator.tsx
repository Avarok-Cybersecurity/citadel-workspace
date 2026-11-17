/**
 * Where a document's edits are, the way Google Docs says it: a quiet cloud while everything is
 * saved (its words on hover and focus, and always to a screen reader), "Saving…" only when a save
 * takes noticeably long (visible-save-state.ts), and plain, persistent words for anything that
 * needs the person: offline, not kept on this device (with Try again when a retry can help),
 * refused, locked. Only a change of what is shown is announced, so typing announces nothing. The
 * indicator is a button: a tap (or Enter) shows what the state means where there is no hover.
 *
 * DocumentSaveControls places this left of the switches so that, as its width changes, nothing
 * the person reaches for moves.
 */
import { useState, type ComponentType, type MouseEvent, type PointerEvent } from 'react';
import { AlertTriangle, HardDrive, Lock, WifiOff } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SaveStatus } from '@/lib/document-save/save-status';
import { SAVE_STATUS_TEXT, type SaveStatusWords } from '@/lib/document-save/save-status-text';
import { isQuietSaveStatus } from '@/lib/document-save/visible-save-state';

type Icon = ComponentType<{ className?: string }>;

/** Lucide's cloud outline with a tick, drawn here: lucide-react 0.462 has no cloud-check. */
function CloudSaved({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      <path d="m9.5 14 2 2 3.5-3.5" />
    </svg>
  );
}

/** Lucide's cloud-upload, drawn here so the shell's icon chunk does not grow for a document's title bar. */
function CloudSaving({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24" />
      <path d="M12 12v9" />
      <path d="m16 16-4-4-4 4" />
    </svg>
  );
}

interface Look {
  readonly icon: Icon;
  /** Classes for the pill; quiet states have none and show no words beside the icon. */
  readonly tone: string;
}

const MUTED: string = 'text-muted-foreground';
const WARNING: string = 'rounded-full border border-warning/30 bg-warning/10 px-[10px] text-warning-emphasis';
const DANGER: string = 'rounded-full border border-destructive/30 bg-destructive/10 px-[10px] text-destructive-emphasis';

const LOOK: Readonly<Record<SaveStatus, Look>> = {
  saved: { icon: CloudSaved, tone: MUTED },
  saving: { icon: CloudSaving, tone: MUTED },
  savedToDevice: { icon: HardDrive, tone: MUTED },
  offline: { icon: WifiOff, tone: WARNING },
  locked: { icon: Lock, tone: WARNING },
  unsavedOnDevice: { icon: AlertTriangle, tone: DANGER },
  refused: { icon: AlertTriangle, tone: DANGER },
};

interface SaveIndicatorProps {
  /** What the title bar shows now (visible-save-state.ts decides; the caller owns the clock). */
  readonly shown: SaveStatus;
  /** A phone-width title bar: the icon alone here, its short words on a row of their own (SaveStatusLine). */
  readonly compact: boolean;
}

/** On a phone the words never sit beside the switches: their width would depend on the font and could wrap the controls. */
export const wordsOnTheirOwnRow = (shown: SaveStatus, compact: boolean): boolean => compact && shown !== 'saved';

/** The short words of a state that needs the person, drawn under a phone's title-bar controls. */
export function SaveStatusLine({ shown }: { readonly shown: SaveStatus }): JSX.Element {
  return <span data-testid="docs-save-status-label" className={`inline-flex min-h-[28px] items-center gap-[6px] text-sm ${LOOK[shown].tone}`}>{SAVE_STATUS_TEXT[shown].short}</span>;
}

export function SaveIndicator({ shown, compact }: SaveIndicatorProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const words: SaveStatusWords = SAVE_STATUS_TEXT[shown];
  const look: Look = LOOK[shown];
  const Glyph: Icon = look.icon;
  const calm: boolean = shown === 'saving' || isQuietSaveStatus(shown);
  // The cloud alone says "saved"; every other state says itself in words, at phone width in its
  // short form, or (the calm ones) by its icon with the words a tap away.
  const drawn: string | null = shown === 'saved' ? null : words.label;
  const inRow: boolean = wordsOnTheirOwnRow(shown, compact);
  return (
    <>
      {/* Announced on a change of what is shown, never per keystroke; what needs the person, with what it means. */}
      <span role="status" aria-live="polite" className="sr-only" data-testid="docs-save-announcer">
        {calm ? words.label : `${words.label}. ${words.detail}`}
      </span>
      <TooltipProvider>
        <Tooltip open={open} onOpenChange={setOpen}>
          <TooltipTrigger asChild>
            {/* A button so a tap shows the details where there is no hover; hover and focus show them too. */}
            <button
              type="button"
              // Radix closes a tooltip on a press of its trigger; here the press is the toggle, so its close is skipped.
              onPointerDown={(event: PointerEvent<HTMLButtonElement>): void => event.preventDefault()}
              onClick={(event: MouseEvent<HTMLButtonElement>): void => {
                event.preventDefault();
                setOpen((was: boolean): boolean => !was);
              }}
              data-testid="docs-save-status"
              data-status={shown}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={`inline-flex min-h-[28px] items-center gap-[6px] ${look.tone}`}>
                <span aria-hidden="true" className="inline-flex shrink-0"><Glyph className="h-4 w-4" /></span>
                {!inRow && <span className={drawn === null ? 'sr-only' : ''} data-testid="docs-save-status-label">{drawn ?? words.label}</span>}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[280px]" data-testid="docs-save-status-detail">{words.detail}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
}
