/** Word's keys for moving and extending the caret, on both platforms. */
import { describe, expect, it } from 'vitest';
import { commandForKey, type KeyLike, type Platform } from '../keymap';
import type { CaretGranularity, EditorCommand } from '../../controller';

const press = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });
const move = (granularity: CaretGranularity, forward: boolean, extend: boolean): EditorCommand => ({ name: 'moveCaret', granularity, forward, extend });

describe('the keymap', () => {
  it.each<[Platform, KeyLike, EditorCommand]>([
    ['other', press('ArrowRight', { shiftKey: true }), move('char', true, true)],
    ['other', press('ArrowLeft', { shiftKey: true, ctrlKey: true }), move('word', false, true)],
    ['mac', press('ArrowLeft', { shiftKey: true, altKey: true }), move('word', false, true)],
    ['other', press('ArrowDown', { shiftKey: true }), move('line', true, true)],
    ['other', press('Home'), move('lineBoundary', false, false)],
    ['other', press('End', { shiftKey: true }), move('lineBoundary', true, true)],
    ['other', press('Home', { ctrlKey: true }), move('document', false, false)],
    ['other', press('End', { ctrlKey: true, shiftKey: true }), move('document', true, true)],
    ['mac', press('ArrowUp', { metaKey: true, shiftKey: true }), move('document', false, true)],
    ['mac', press('ArrowRight', { metaKey: true }), move('lineBoundary', true, false)],
    ['other', press('a', { ctrlKey: true }), { name: 'selectAll' }],
    ['mac', press('a', { metaKey: true }), { name: 'selectAll' }],
    ['other', press('Backspace'), { name: 'deleteBackward', unit: 'char' }],
    ['other', press('Delete', { ctrlKey: true }), { name: 'deleteForward', unit: 'word' }],
  ])('%s: %j', (platform: Platform, key: KeyLike, command: EditorCommand) => {
    expect(commandForKey(key, platform)).toEqual(command);
  });

  it('leaves PageUp and PageDown to the page view, which knows how far a screen is', () => {
    expect(commandForKey(press('PageDown'), 'other')).toBeNull();
    expect(commandForKey(press('PageUp', { shiftKey: true }), 'mac')).toBeNull();
  });
});
