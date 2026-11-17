import { describe, expect, it, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SecurityLevelSelect } from '../SecurityLevelSelect';

// Radix Select calls these, which jsdom does not implement.
beforeAll((): void => {
  Element.prototype.hasPointerCapture = (): boolean => false;
  Element.prototype.releasePointerCapture = (): void => undefined;
  Element.prototype.scrollIntoView = (): void => undefined;
});

function open(): void {
  const trigger: HTMLElement = screen.getByRole('combobox');
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

const disabled = (level: string): boolean => screen.getByTestId(`security-level-${level}`).hasAttribute('data-disabled');

describe('levels above the account registration are disabled', () => {
  it('a Standard account can choose only Standard', () => {
    render(<SecurityLevelSelect value="Standard" maxLevel={0} />);
    open();
    expect(disabled('Standard')).toBe(false);
    expect(['Reinforced', 'High', 'Extreme'].map(disabled)).toEqual([true, true, true]);
    expect(screen.getByTestId('security-level-limit').textContent).toContain('registered at Standard');
  });

  it('a High account can choose up to High', () => {
    render(<SecurityLevelSelect value="Standard" maxLevel={2} />);
    open();
    expect(['Standard', 'Reinforced', 'High', 'Extreme'].map(disabled)).toEqual([false, false, false, true]);
  });

  it('with no known level, every level is offered and no limit is stated', () => {
    render(<SecurityLevelSelect value="Standard" />);
    open();
    expect(['Standard', 'Reinforced', 'High', 'Extreme'].map(disabled)).toEqual([false, false, false, false]);
    expect(screen.queryByTestId('security-level-limit')).toBeNull();
  });

  it('a saved choice above the limit is flagged', () => {
    render(<SecurityLevelSelect value="Extreme" maxLevel={0} />);
    expect(screen.getByTestId('security-level-limit').className).toContain('text-destructive');
  });
});
