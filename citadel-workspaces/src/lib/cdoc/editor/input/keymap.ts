/**
 * Keys -> editor commands. Pure: a key event's fields and the platform in, a command (or
 * nothing, and the key is left to the browser) out. Printable text never comes from here; it
 * arrives through the IME bridge's input events, which is the only path that is right for
 * dead keys, compose sequences and IMEs alike.
 *
 * Ctrl/Cmd with = + - 0 is not mapped: the page view zooms on those (Word's sub- and
 * superscript keys are the ribbon's). Word-wise moves and deletes use Alt on macOS and Ctrl elsewhere; shortcuts use Cmd on macOS
 * and Ctrl elsewhere; Shift extends any caret move.
 */
import type { CaretGranularity, EditorCommand } from '../controller';

export type Platform = 'mac' | 'other';

export interface KeyLike {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

function move(granularity: CaretGranularity, forward: boolean, extend: boolean): EditorCommand {
  return { name: 'moveCaret', granularity, forward, extend };
}

function shortcut(key: string, shift: boolean): EditorCommand | null {
  switch (key.toLowerCase()) {
    case 'b': return shift ? null : { name: 'toggleMark', mark: 'bold' };
    case 'i': return shift ? null : { name: 'toggleMark', mark: 'italic' };
    case 'u': return shift ? null : { name: 'toggleMark', mark: 'underline' };
    case 'z': return { name: shift ? 'redo' : 'undo' };
    case 'y': return shift ? null : { name: 'redo' };
    case 'a': return shift ? null : { name: 'selectAll' };
    case ']': return shift ? null : { name: 'indent' };
    case '[': return shift ? null : { name: 'outdent' };
    default: return null;
  }
}

export function commandForKey(e: KeyLike, platform: Platform): EditorCommand | null {
  const mac: boolean = platform === 'mac';
  const mod: boolean = mac ? e.metaKey : e.ctrlKey;
  const word: boolean = mac ? e.altKey : e.ctrlKey;
  const extend: boolean = e.shiftKey;
  switch (e.key) {
    case 'Backspace': return { name: 'deleteBackward', unit: word ? 'word' : 'char' };
    case 'Delete': return { name: 'deleteForward', unit: word ? 'word' : 'char' };
    case 'Enter':
      if (e.shiftKey) return { name: 'insertBreak', kind: 'line' };
      if (mod) return { name: 'insertBreak', kind: 'page' };
      return { name: 'splitParagraph' };
    case 'Tab': return e.shiftKey ? { name: 'outdent' } : { name: 'insertTab' };
    case 'ArrowLeft':
    case 'ArrowRight': {
      const forward: boolean = e.key === 'ArrowRight';
      if (mac && e.metaKey) return move('lineBoundary', forward, extend);
      return move(word ? 'word' : 'char', forward, extend);
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      const forward: boolean = e.key === 'ArrowDown';
      if (mac && e.metaKey) return move('document', forward, extend);
      if (mac ? e.altKey : e.ctrlKey) return move('paragraph', forward, extend);
      return move('line', forward, extend);
    }
    case 'Home':
    case 'End': return move(e.ctrlKey || e.metaKey ? 'document' : 'lineBoundary', e.key === 'End', extend);
    default:
      return mod && !e.altKey ? shortcut(e.key, e.shiftKey) : null;
  }
}
