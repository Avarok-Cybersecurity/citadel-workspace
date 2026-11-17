/**
 * The first-run prompt, read the way a person meets it.
 *
 * A real deployment's owner could not get through this dialog. The mechanism was
 * never broken -- the request reached the server and was correctly refused -- so
 * everything that failed here is text:
 *
 *   - the field said "Workspace Password", placeholder "Enter the workspace
 *     password", while the connect step one screen earlier says "Workspace
 *     Password (Optional)" for a DIFFERENT secret and the join step before that
 *     asked them to invent a third. They went looking and found the wrong one.
 *   - the helper said "Contact your workspace administrator", and on a server
 *     nobody has claimed there is no administrator: this prompt is how the first
 *     one comes to exist.
 *   - the refusal arrived as "Something went wrong: Failed to update workspace:
 *     Invalid workspace master access password", which they read as a glitch
 *     rather than as a rejected password.
 *
 * RENDERED, not read off the source. `init-modal-does-not-eject.test.ts` asserts
 * this file's TEXT for /master password/i, and a source assertion cannot tell
 * copy the app draws from copy sitting in a comment -- this file's comments
 * contain every phrase below. Everything here goes through the DOM the component
 * actually produces, and the error case is driven through the real submit
 * handler so that the sentence asserted is the sentence a person would see.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ErrorPayload } from '@/lib/workspace-events';
import { WorkspaceInitializationModal } from '../WorkspaceInitializationModal';

/** Captured when the modal subscribes, so the test can answer as the server. */
let rejectWith: ((payload: ErrorPayload) => void) | null = null;

vi.mock('@/lib/workspace-events', () => ({
  workspaceEvents: {
    onWorkspaceEvent: async (): Promise<() => void> => (): void => {},
    onOperationEvent: async (
      _event: string,
      handler: (payload: ErrorPayload) => void,
    ): Promise<() => void> => {
      rejectWith = handler;
      return (): void => {};
    },
  },
}));

vi.mock('@/lib/workspace-service', () => ({
  default: {
    sendWorkspaceRequest: async (): Promise<void> => {},
    getUserPermissions: async (): Promise<void> => {},
  },
}));

function renderPrompt(): void {
  render(
    <WorkspaceInitializationModal
      isOpen
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      workspaceName="Design"
      workspaceId="root"
      serverAddress="citadel.example.com:12400"
      username="ada"
      fullName="Ada Lovelace"
    />,
  );
}

/** Everything the dialog draws, as one string. */
function visibleText(): string {
  return screen.getByRole('dialog').textContent ?? '';
}

beforeEach((): void => {
  rejectWith = null;
});

describe('what the initialization prompt tells you', () => {
  it('tells the owner of a hosted workspace that their claim code goes here', () => {
    // Measured live on admin-lab: an owner holding a claim code was told only about an
    // environment variable in a .env file on a server they never deployed.
    renderPrompt();
    expect(visibleText()).toMatch(/claim code/i);
  });

  it('names the variable the operator set, not just "the workspace password"', () => {
    renderPrompt();
    expect(visibleText()).toContain('WORKSPACE_MASTER_PASSWORD');
  });

  it('says it is not the account password chosen minutes earlier', () => {
    renderPrompt();
    expect(visibleText()).toMatch(/not the account password|not the password you chose/i);
  });

  it('says where an operator keeps it', () => {
    renderPrompt();
    expect(visibleText()).toMatch(/environment/i);
    expect(visibleText()).toMatch(/\.env/);
  });

  it('does not send the reader to an administrator who does not exist yet', () => {
    // The old helper text. On a server awaiting its first admin there is nobody
    // to contact, and this dialog is the thing that creates one.
    renderPrompt();
    expect(visibleText()).not.toMatch(/contact your workspace administrator/i);
  });

  it('does not label the field with the same two words as the OTHER password', () => {
    // ServerConnect's optional server password is labelled "Workspace Password".
    // Two different secrets, one screen apart, under one name.
    renderPrompt();
    const field: HTMLInputElement = screen.getByLabelText(/workspace master password/i);
    expect(field.placeholder).not.toMatch(/^Enter the workspace password$/);
    expect(field.placeholder).toContain('WORKSPACE_MASTER_PASSWORD');
  });

  it('offers a way out and says what declining costs', () => {
    renderPrompt();
    expect(screen.getByTestId('init-modal-decline')).toBeTruthy();
    // Not merely a button: the consequence, which is that nothing is lost.
    expect(visibleText()).toMatch(/workspace already works|can finish the step later/i);
  });

  it('tells someone who is not the operator whom to ask', () => {
    renderPrompt();
    expect(visibleText()).toMatch(/the person who did|ask them/i);
  });
});

describe('when the server refuses the password', () => {
  it('says the password was wrong, in the dialog, in words', async (): Promise<void> => {
    renderPrompt();
    await userEvent.type(
      screen.getByLabelText(/workspace master password/i),
      'not-the-right-one',
    );
    await userEvent.click(screen.getByTestId('init-modal-submit'));

    await waitFor((): void => expect(rejectWith).not.toBeNull());
    // Verbatim from async_domain_server_ops.rs:1247, wrapped as the workspace
    // layer wraps it. This is the exact string the live deployment produced.
    rejectWith?.({
      message: 'Failed to update workspace: Invalid workspace master access password',
      connection: { cid: 1n, request_id: 'test' },
    });

    const shown: HTMLElement = await screen.findByTestId('init-modal-error');
    expect(shown.textContent).not.toMatch(/something went wrong/i);
    expect(shown.textContent).not.toMatch(/Failed to update workspace/i);
    expect(shown.textContent).toContain('WORKSPACE_MASTER_PASSWORD');
  });

  it('refuses an empty field by naming which password it wants', async (): Promise<void> => {
    renderPrompt();
    await userEvent.click(screen.getByTestId('init-modal-submit'));

    const shown: HTMLElement = await screen.findByTestId('init-modal-error');
    expect(shown.textContent).toMatch(/master password/i);
  });
});
