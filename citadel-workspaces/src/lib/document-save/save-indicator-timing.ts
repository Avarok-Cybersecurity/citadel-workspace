/**
 * How long a save may take before the title bar mentions it, and how long the mention stays.
 * 1.5 s: shorter than any wait a person notices as a stall, longer than a save on a working link
 * (one round trip and a device write). 1 s: long enough to read "Saving…" rather than see a flash.
 */
import type { SaveIndicatorTiming } from './visible-save-state';

export const SAVE_INDICATOR_TIMING: SaveIndicatorTiming = { showSavingAfterMs: 1500, minSavingShownMs: 1000 };
