/**
 * Script-driven motion follows the Animations setting while mounted.
 *
 * index.css stops CSS motion under `.reduce-motion` and lightens it under
 * `.lite-motion`; framer's motion is script-driven, so the focused sidebar
 * reads the same document state itself (see use-motion-tier) and must follow
 * it -- including a downgrade that lands after the tree has mounted.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { applyAppearanceSettings, defaultAppearanceSettings, type AppearanceSettings } from '@/lib/appearance-settings';
import { useMotionTier } from '../use-motion-tier';

function Probe(): JSX.Element {
  return <output data-testid="motion">{useMotionTier()}</output>;
}

const choose = (animations: AppearanceSettings['animations']): void => applyAppearanceSettings({ ...defaultAppearanceSettings, animations });

afterEach(() => choose('full'));

describe('useMotionTier', () => {
  it('follows the setting every way while mounted', async () => {
    choose('full');
    render(<Probe />);
    expect(screen.getByTestId('motion')).toHaveTextContent('full');
    for (const tier of ['lite', 'off', 'full'] as const) {
      await act(async () => { choose(tier); });
      expect(screen.getByTestId('motion')).toHaveTextContent(tier);
    }
  });

  it('starts off when the setting was already off', () => {
    choose('off');
    render(<Probe />);
    expect(screen.getByTestId('motion')).toHaveTextContent('off');
  });
});
