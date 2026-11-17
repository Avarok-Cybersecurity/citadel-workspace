/**
 * What a bubble needs to show and change reactions, whichever chat it is in.
 *
 * P2P and peer-group bubbles are different components over different message
 * types; this is the one shape both are handed, so the picker and the chips
 * are written once.
 */
import type { ReactionChip } from '@/lib/reactions/reaction-state';

export interface ReactionBinding {
  chips: ReactionChip[];
  /** The name to show for a reactor; the viewer is "You". */
  nameFor: (cid: bigint) => string;
  /** Toggle the viewer's own `emoji`: add it, or remove it if they have it. */
  onReact: (emoji: string) => void;
}

/** "You and alice reacted with 👍" -- the tooltip and the chip's accessible name. */
export function reactorsLabel(chip: ReactionChip, nameFor: (cid: bigint) => string): string {
  const names: string[] = chip.reactorCids.map(nameFor);
  const joined: string = names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${joined} reacted with ${chip.emoji}`;
}
