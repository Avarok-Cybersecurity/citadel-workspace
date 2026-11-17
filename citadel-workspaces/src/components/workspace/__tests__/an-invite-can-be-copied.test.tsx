/**
 * The invite dialog hands over something to send: the address, and a link that
 * opens the join wizard with it filled in.
 *
 * Live it showed "The workspace address is not available yet" with no copy
 * control: the address came only from the connection record, which a resumed
 * tab can hold as a bare CID. The tab's selection names the server too.
 *
 * Mocked: `navigator.clipboard` (a browser permission jsdom lacks) and the tab
 * selection read (IndexedDB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/tab-context', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  getSelectedUser: async (): Promise<{ selectedUsername: string; selectedServerAddress: string }> => ({
    selectedUsername: 'alice0924', selectedServerAddress: 'work.example.net:12349',
  }),
}));
const toasts: { title?: string }[] = [];
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: (t: { title?: string }) => void } => ({ toast: (t: { title?: string }): void => { toasts.push(t); } }) }));

import { InviteToWorkspaceDialog } from '../InviteToWorkspaceDialog';
import { inviteLink, joinServerFrom } from '@/lib/invite-link';

const writes: string[] = [];
beforeEach((): void => {
  writes.length = 0;
  toasts.length = 0;
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async (t: string): Promise<void> => { writes.push(t); } },
    configurable: true,
  });
});

describe('the invite dialog', () => {
  it('copies the address and says so', async () => {
    render(<InviteToWorkspaceDialog open onOpenChange={vi.fn()} workspaceName="Acme" serverAddress="work.example.net:12349" />);
    fireEvent.click(screen.getByRole('button', { name: /copy address/i }));
    await waitFor(() => expect(writes).toEqual(['work.example.net:12349']));
    expect(toasts.map((t) => t.title)).toContain('Address copied');
  });

  it('copies a link that opens the join wizard with the server filled in', async () => {
    render(<InviteToWorkspaceDialog open onOpenChange={vi.fn()} workspaceName="Acme" serverAddress="work.example.net:12349" />);
    fireEvent.click(screen.getByRole('button', { name: /copy invite link/i }));
    await waitFor(() => expect(writes).toHaveLength(1));
    const link: URL = new URL(writes[0]);
    expect(link.origin).toBe(window.location.origin);
    expect(link.searchParams.get('join')).toBe('1');
    expect(link.searchParams.get('server')).toBe('work.example.net:12349');
    expect(toasts.map((t) => t.title)).toContain('Invite link copied');
  });

  it('shows and shares a hosted workspace by its host, not the URL the agent dialled', async () => {
    render(<InviteToWorkspaceDialog open onOpenChange={vi.fn()} workspaceName="Acme" serverAddress="wss://acme.work.avarok.net/" />);
    expect(screen.getByText('acme.work.avarok.net')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /copy address/i }));
    fireEvent.click(screen.getByRole('button', { name: /copy invite link/i }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0]).toBe('acme.work.avarok.net');
    expect(new URL(writes[1]).searchParams.get('server')).toBe('acme.work.avarok.net');
  });

  it('finds the address from the tab when the connection record has none', async () => {
    render(<InviteToWorkspaceDialog open onOpenChange={vi.fn()} workspaceName="Acme" serverAddress={undefined} />);
    expect(await screen.findByText('work.example.net:12349')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy invite link/i })).toBeEnabled();
  });
});

describe('the invite link', () => {
  it('round-trips through the join wizard reader', () => {
    const link: URL = new URL(inviteLink('https://work.example.net', 'work.example.net:12349'));
    expect(joinServerFrom(link.searchParams)).toBe('work.example.net:12349');
  });

  it('is not read when it is not an address', () => {
    expect(joinServerFrom(new URLSearchParams('join=1'))).toBeNull();
    expect(joinServerFrom(new URLSearchParams('server=%20%20'))).toBeNull();
    expect(joinServerFrom(new URLSearchParams(`server=${'a'.repeat(300)}`))).toBeNull();
    expect(joinServerFrom(new URLSearchParams('server=a%20b'))).toBeNull();
  });
});
