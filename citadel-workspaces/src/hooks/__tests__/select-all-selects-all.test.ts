/**
 * Ctrl+A selects everything visible, whatever was selected before.
 *
 * `handleSelectAll` looped `selectItem(path, i === 0 ? 'replace' : 'toggle')`.
 * It works — but only because `replace` clears the set before the toggles run.
 * Read in isolation, "toggle every item" is the opposite of "select all", and
 * it becomes so the moment the first item stops being `replace`: reorder the
 * loop, filter the first item out, or make the list empty at index 0, and
 * Ctrl+A starts DESELECTING whatever was already picked.
 *
 * `selectAll` was on the selection hook the whole time, with no caller. This
 * pins the property the loop had by accident.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVFSSelection } from '../useVFSSelection';

describe('selectAll', () => {
  it('selects every path given, from nothing', () => {
    const { result } = renderHook(() => useVFSSelection());

    act((): void => { result.current.selectAll(['/a', '/b', '/c']); });

    expect([...result.current.selectedPaths].sort()).toEqual(['/a', '/b', '/c']);
  });

  it('selects every path given when one is ALREADY selected', () => {
    // The case the toggle loop only survives by ordering.
    const { result } = renderHook(() => useVFSSelection());
    act((): void => { result.current.select('/b', 'replace'); });
    expect(result.current.isSelected('/b')).toBe(true);

    act((): void => { result.current.selectAll(['/a', '/b', '/c']); });

    expect([...result.current.selectedPaths].sort()).toEqual(['/a', '/b', '/c']);
  });

  it('drops anything not in the list, so a filtered Ctrl+A means what it says', () => {
    // Selecting under a filter must not leave hidden files selected: Delete
    // would then remove files the user could not see.
    const { result } = renderHook(() => useVFSSelection());
    act((): void => { result.current.selectAll(['/a', '/hidden']); });

    act((): void => { result.current.selectAll(['/a']); });

    expect([...result.current.selectedPaths]).toEqual(['/a']);
  });
});
