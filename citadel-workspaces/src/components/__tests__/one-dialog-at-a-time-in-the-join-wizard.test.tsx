/**
 * Two dialogs at once, one of them blurred behind the other.
 *
 * The person who could not get through first-run setup reported "a modal hidden
 * and blurred behind" the one they were typing into. Join is where that is
 * reproducible: its own overlay is a `fixed inset-0 ... bg-black/60
 * backdrop-blur-sm` div carrying `role="dialog" aria-modal="true"`, and it
 * renders TWO further dialogs INSIDE that div -- the connect progress modal and
 * the workspace-not-initialized notice. Each of those paints its own identical
 * scrim, so the wizard card underneath stayed on screen, dimmed twice and
 * blurred, under the notice being read.
 *
 * It is not only a picture. `useDialogOverlay` traps Tab and listens for Escape
 * on the document, and its own comment says why a nesting parent must stand
 * down: "two live traps both listening on the document would answer one Escape
 * twice and fight over focus". Login does exactly that for SecuritySettings
 * (`enabled: !showSecuritySettings`). Join never did -- the same fix, in the
 * same hook, one file away, never carried across.
 *
 * So: exactly one `aria-modal` dialog, whichever nested surface is up.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { JoinRegistration } from '../join-registration-shape';
import { Join } from '../Join';
import { BLANK_JOIN_FORM } from '../join-form-blank';

/**
 * What `useJoinRegistration` returns, with only the flags each case needs
 * overridden.
 *
 * The hook itself registers websocket listeners and talks to the connection
 * manager; none of that decides how many dialogs are drawn, which is the whole
 * question here. The two booleans that DO decide it are set explicitly, so the
 * state under test is visible in the test rather than arrived at by driving a
 * registration that would need a backend.
 */
const registration: JoinRegistration = {
  formData: BLANK_JOIN_FORM,
  isRegistering: false,
  showNotInitializedModal: false,
  showConnectModal: false,
  connectStatus: 'connecting',
  handleInputChange: vi.fn(),
  handleBlur: vi.fn(),
  fieldErrors: {},
  handleSubmit: vi.fn(),
  handleConnectModalComplete: vi.fn(),
  handleReturnToLogin: vi.fn(),
  recoveryCodes: [],
  awaitingSignIn: null,
  finishSignIn: vi.fn(),
} as unknown as JoinRegistration;

let overrides: Partial<JoinRegistration> = {};

vi.mock('../useJoinRegistration', () => ({
  useJoinRegistration: (): JoinRegistration => ({ ...registration, ...overrides }),
}));

function renderJoin(state: Partial<JoinRegistration>): void {
  overrides = state;
  render(
    <MemoryRouter>
      <Join onNext={vi.fn()} onBack={vi.fn()} serverAddress="citadel.example.com:12400" serverPassword="" />
    </MemoryRouter>,
  );
}

/** Only surfaces that CLAIM to be the modal dialog. */
function modalDialogs(): HTMLElement[] {
  return screen
    .queryAllByRole('dialog')
    .filter((element: HTMLElement) => element.getAttribute('aria-modal') === 'true');
}

describe('the join wizard', () => {
  it('is one dialog while nothing is nested inside it', () => {
    // The control for the two cases below: if this were already 2, the counts
    // there would prove nothing about nesting.
    renderJoin({});
    expect(modalDialogs()).toHaveLength(1);
  });

  it('does not stay on screen behind the not-initialized notice', () => {
    renderJoin({ showNotInitializedModal: true });

    expect(modalDialogs()).toHaveLength(1);
    // And it is the notice, not the wizard, that is left standing: registration
    // was refused, so there is nothing to go back to filling in.
    expect(screen.getByRole('dialog')).toHaveTextContent(/Workspace Not Initialized/i);
    expect(screen.queryByText('Create Your Profile')).toBeNull();
  });

  it('stands down its own dialog treatment while the connect modal is up', () => {
    // The form legitimately stays visible under a progress overlay -- that one
    // is reporting on the form. What must not happen is two focus traps and two
    // Escape handlers over it.
    renderJoin({ showConnectModal: true, connectStatus: 'connecting' });
    expect(modalDialogs()).toHaveLength(1);
  });
});
