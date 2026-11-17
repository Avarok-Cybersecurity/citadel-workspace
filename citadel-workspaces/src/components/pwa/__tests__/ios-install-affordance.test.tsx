/**
 * iOS users must be told how to install, because their platform cannot offer it.
 *
 * iOS Safari never fires `beforeinstallprompt` — there is no programmatic
 * install on that platform at all — so `canInstall` is permanently false there
 * and `InstallAppButton` rendered nothing. That silently zeroed the install
 * funnel for every iPhone and iPad, on a product whose primary mobile surface is
 * the installed PWA. The manifest and apple-touch-icon groundwork was already
 * in place; only the affordance was missing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const state: { canInstall: boolean; needsManualInstall: boolean; } = { canInstall: false, needsManualInstall: false };
vi.mock('../use-install-action', () => ({
  useInstallAction: (): { installNow: () => void; canInstall: boolean; needsManualInstall: boolean; } => ({ ...state, installNow: (): void => {} }),
}));

import { InstallAppButton } from '../InstallAppButton';

describe('the install affordance', () => {
  beforeEach(() => {
    state.canInstall = false;
    state.needsManualInstall = false;
  });

  it('tells an iOS user the manual steps', () => {
    state.needsManualInstall = true;
    render(<InstallAppButton />);

    expect(screen.getByText(/Share/)).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
  });

  it('offers the real button where the browser can prompt', () => {
    state.canInstall = true;
    render(<InstallAppButton />);

    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument();
  });

  it('renders nothing when the app is already installed', () => {
    // Both false is the installed case — showing install instructions to
    // someone already inside the installed app is worse than showing nothing.
    const { container } = render(<InstallAppButton />);

    expect(container).toBeEmptyDOMElement();
  });
});
