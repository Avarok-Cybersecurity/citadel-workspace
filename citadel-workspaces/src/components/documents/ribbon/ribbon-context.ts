/**
 * What every ribbon control reads: whether commands can run (and if not, why), the caret's
 * formatting, the environment, and whether groups are collapsed for a phone. One runner sends
 * every command, so a rejection is always shown and focus always returns to the document.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type Context, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import type { CaretFormatting, EditorCommand, EditorState, SelectionText, Story } from '@/lib/cdoc/editor/controller';
import type { ActionGate } from '@/hooks/use-permission-result';
import { describeError } from '@/lib/describe-error';
import type { RibbonEditor } from './editor-context';
import type { RibbonEnvironment } from './ribbon-environment';

export interface Ribbon {
  /** The last refusal, kept in the ribbon's status line until a later command succeeds. */
  readonly failure: string | null;
  /** What the status line says otherwise: a quiet result ("Copied.") or why a pressed control did nothing. */
  readonly notice: string | null;
  /** Why no command can run now, or null when they can. */
  readonly disabledReason: string | null;
  /**
   * Why the document cannot even be read from now (still opening, or mid-composition), or null.
   * Reading (Copy) is never refused for want of permission to edit.
   */
  readonly readReason: string | null;
  readonly caret: CaretFormatting;
  /** The selection's text as the last result carried it; null with no editor. */
  readonly selection: SelectionText | null;
  /** The story the selection is in (the body, a header or footer, a footnote); null with no editor. */
  readonly story: Story | null;
  readonly environment: RibbonEnvironment;
  /** Groups collapse into one button each (phone width). */
  readonly compact: boolean;
  /** Sends `command`; `what` completes "Could not …" if the editor refuses it. */
  run(command: EditorCommand, what: string): Promise<void>;
  /**
   * Runs `work` on the open editor the way `run` runs a command: a failure is shown, and focus
   * returns after. `done` is said in the status line on success, for work the page does not show.
   */
  attempt(what: string, work: (editor: RibbonEditor) => Promise<unknown>, options?: AttemptOptions): Promise<void>;
  /** Says in the status line why a control that was pressed could not act (a tap shows no tooltip). */
  explain(reason: string): void;
  /** Hands keyboard focus back to the document, e.g. after a dialog closes with nothing done. */
  returnFocus(): void;
}

export interface AttemptOptions {
  /** Said in the status line on success, for work the page does not show. */
  readonly done?: string;
  /** The work only reads the document, so it runs where editing is not allowed. */
  readonly reads?: boolean;
}

export const RibbonContext: Context<Ribbon | null> = createContext<Ribbon | null>(null);

export function useRibbon(): Ribbon {
  const ribbon: Ribbon | null = useContext(RibbonContext);
  if (ribbon === null) throw new Error('a ribbon control is rendered outside DocsRibbon');
  return ribbon;
}

const UNKNOWN: CaretFormatting = { known: false };

function readReasonFor(editor: RibbonEditor | null, state: EditorState | null): string | null {
  if (editor === null || state === null) return 'The document is still opening.';
  if (state.composing) return 'Finish the text you are composing first.';
  return null;
}

function editReasonFor(edit: ActionGate): string | null {
  return edit.enabled ? null : edit.reason ?? 'You cannot edit this document.';
}

/** Long enough for a screen reader to see the status line emptied before the notice is written. */
const ANNOUNCE_GAP_MS: number = 50;

/** How long a refusal's toast stays: long enough to read twice; the status line keeps it after. */
const REFUSAL_TOAST_MS: number = 8000;

export function useRibbonValue(editor: RibbonEditor | null, state: EditorState | null, edit: ActionGate, environment: RibbonEnvironment, compact: boolean): Ribbon {
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A notice is about the moment it was given; once the selection moves it no longer applies.
  useEffect((): void => { setNotice(null); }, [state]);
  // A menu closing or a command settling after the document has gone has no document to focus.
  const mounted: MutableRefObject<boolean> = useRef<boolean>(true);
  useEffect((): (() => void) => {
    mounted.current = true;
    return (): void => { mounted.current = false; };
  }, []);
  return useMemo((): Ribbon => {
    const returnFocus = (): void => { if (mounted.current) editor?.focus(); };
    // Emptied first, so saying the same thing twice ("Copied." again) is announced again.
    const say = (message: string | null): void => {
      setNotice(null);
      if (message !== null) setTimeout((): void => { if (mounted.current) setNotice(message); }, ANNOUNCE_GAP_MS);
    };
    const readReason: string | null = readReasonFor(editor, state);
    const disabledReason: string | null = editReasonFor(edit) ?? readReason;
    const attempt = async (what: string, work: (live: RibbonEditor) => Promise<unknown>, options: AttemptOptions = {}): Promise<void> => {
      if (editor === null || (options.reads === true ? readReason : disabledReason) !== null) return;
      try {
        await work(editor);
        setFailure(null);
        say(options.done ?? null);
      } catch (error: unknown) {
        const message: string = `Could not ${what}. ${describeError(error)}`;
        // Finite, so on a phone it never sits over the ribbon for good; the status line keeps it.
        toast.error(message, { duration: REFUSAL_TOAST_MS });
        setFailure(message);
      } finally {
        returnFocus();
      }
    };
    return {
      failure,
      notice,
      disabledReason,
      readReason,
      caret: state?.caretFormatting ?? UNKNOWN,
      selection: state?.selectionText ?? null,
      story: state?.story ?? null,
      environment,
      compact,
      run: (command: EditorCommand, what: string): Promise<void> => attempt(what, (live: RibbonEditor): Promise<EditorState> => live.execute(command)),
      attempt,
      explain: (reason: string): void => { setFailure(null); say(reason); },
      returnFocus,
    };
  }, [editor, state, edit, environment, compact, failure, notice]);
}
