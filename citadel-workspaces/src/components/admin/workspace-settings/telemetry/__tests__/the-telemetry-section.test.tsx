/**
 * The admin Telemetry section is there only for people the server lets in, offers only what their
 * permissions allow, and sends what the controls say.
 *
 * Mocked: `usePermission` (an agent round-trip) and the telemetry requests (workspace I/O). The
 * section, its forms and the rules are production.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TelemetrySettings } from 'citadel-workspace-client-ts';
import type { TelemetryApi } from '@/lib/telemetry/telemetry-api';
import type { UsePermissionResult } from '@/hooks/use-permission-result';

const granted: { current: Set<string> } = vi.hoisted(() => ({ current: new Set<string>() }));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (_domain: string, permission: string): UsePermissionResult =>
    ({ allowed: granted.current.has(permission), loading: false, reason: null, unanswered: false, answered: true, refresh: async (): Promise<void> => {} }) as UsePermissionResult,
}));
type ApiMocks<K extends keyof TelemetryApi> = { [P in K]: Mock<TelemetryApi[P]> };
const api: ApiMocks<'getSettings' | 'list' | 'accessLog' | 'setPolicy' | 'setSupportAccess' | 'getTerms' | 'setWorkspaceTerms'> = vi.hoisted(() => ({ getSettings: vi.fn(), list: vi.fn(), accessLog: vi.fn(), setPolicy: vi.fn(), setSupportAccess: vi.fn(), getTerms: vi.fn(), setWorkspaceTerms: vi.fn() }));
vi.mock('@/lib/telemetry/telemetry-api', () => ({ telemetryApi: api }));
import { TelemetrySection } from '../TelemetrySection';

const SETTINGS: TelemetrySettings = {
  policy: { retention_days: 30, per_user_bytes: 20n * 1024n * 1024n }, max_retention_days: 90, max_per_user_bytes: 50n * 1024n * 1024n,
  support_access: { enabled: false, until_ms: null },
};
const ADMIN: string[] = ['ViewTelemetry', 'EditWorkspaceConfig'];

beforeEach(() => {
  vi.resetAllMocks();
  granted.current = new Set(ADMIN);
  api.getSettings.mockResolvedValue(SETTINGS);
  api.accessLog.mockResolvedValue([]);
  api.getTerms.mockResolvedValue({ platform: { version: 1, text: 'p' }, workspace: null });
});

describe('who sees the section', () => {
  it('nobody without either permission, and nothing is requested', () => {
    granted.current = new Set(['EditTreeStructure']);
    const { container } = render(<TelemetrySection />);
    expect(container).toBeEmptyDOMElement();
    expect(api.getSettings).not.toHaveBeenCalled();
  });

  it('a viewer reads logs and the access log but cannot change limits, terms or support access', async () => {
    granted.current = new Set(['ViewTelemetry']);
    render(<TelemetrySection />);
    expect(await screen.findByTestId('telemetry-log-viewer')).toBeInTheDocument();
    expect(await screen.findByLabelText(/Keep for/)).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Allow Avarok support access' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save limits' })).toBeNull();
    await waitFor(() => expect(screen.getByLabelText(/Workspace terms/)).toBeDisabled());
  });

  it('someone who can only edit configuration gets the terms editor and no logs', async () => {
    granted.current = new Set(['EditWorkspaceConfig']);
    render(<TelemetrySection />);
    expect(await screen.findByTestId('workspace-terms-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('telemetry-log-viewer')).toBeNull();
    expect(api.getSettings).not.toHaveBeenCalled();
  });
});

describe('the log viewer', () => {
  it('sends the filter as typed, shows what comes back, and pages', async () => {
    api.list.mockResolvedValue({ has_more: true, records: [{
      user_id: 'alice', received_at_ms: 1n, agent_version: '0.9.1', os: 'macos',
      entry: { time_ms: 1_700_000_000_000n, level: 'Error', target: 'agent::p2p', message: 'handshake failed', peer_cid: 42n, metric: null },
    }] });
    render(<TelemetrySection />);
    await userEvent.type(await screen.findByLabelText('User'), 'alice');
    await userEvent.type(screen.getByLabelText('Peer CID'), '42');
    await userEvent.selectOptions(screen.getByLabelText('Level'), 'Error');
    await userEvent.click(screen.getByRole('button', { name: 'Show logs' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledWith(
      { user_id: 'alice', peer_cid: 42n, min_level: 'Error', since_ms: null, until_ms: null }, { offset: 0, limit: 50 }));
    expect(await screen.findByText(/handshake failed/)).toBeInTheDocument();
    expect(screen.getByText(/peer 42/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.anything(), { offset: 50, limit: 50 }));
  });

  it('lists metrics with everything, and asks for warnings and errors by name', async () => {
    api.list.mockResolvedValue({ has_more: false, records: [{
      user_id: 'alice', received_at_ms: 1n, agent_version: '0.9.1', os: 'macos',
      entry: { time_ms: 1_700_000_000_000n, level: 'Metric', target: 'citadel::metric', message: 'path attempt 1: DirectOnly plan, attached Direct', peer_cid: 42n, metric: null },
    }] });
    render(<TelemetrySection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show logs' }));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(
      { user_id: null, peer_cid: null, min_level: null, since_ms: null, until_ms: null }, { offset: 0, limit: 50 }));
    expect(await screen.findByText(/attached Direct/)).toBeInTheDocument();
    expect(screen.getByText('Metric')).toHaveClass('text-muted-foreground');
    await userEvent.selectOptions(screen.getByLabelText('Level'), 'Warnings and errors');
    await userEvent.click(screen.getByRole('button', { name: 'Show logs' }));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ min_level: 'Warn' }), { offset: 0, limit: 50 }));
  });

  it('refuses a malformed peer CID without asking the server', async () => {
    render(<TelemetrySection />);
    await userEvent.type(await screen.findByLabelText('Peer CID'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Show logs' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A peer CID is a whole number.');
    expect(api.list).not.toHaveBeenCalled();
  });
});

describe('retention and size', () => {
  it('shows the limits, refuses more than the maximum, and saves within it', async () => {
    api.setPolicy.mockResolvedValue({ ...SETTINGS, policy: { retention_days: 60, per_user_bytes: 20n * 1024n * 1024n } });
    render(<TelemetrySection />);
    const days: HTMLElement = await screen.findByLabelText(/Keep for/);
    expect(days).toHaveValue('30');
    await userEvent.clear(days);
    await userEvent.type(days, '91');
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Retention can be at most 90 days.')).toBeInTheDocument();
    expect(api.setPolicy).not.toHaveBeenCalled();
    await userEvent.clear(days);
    await userEvent.type(days, '60');
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    await waitFor(() => expect(api.setPolicy).toHaveBeenCalledWith(60, 20n * 1024n * 1024n));
  });
});

describe('support access', () => {
  it('is off, and turning it on sends an expiry that many days ahead', async () => {
    api.setSupportAccess.mockResolvedValue({ ...SETTINGS, support_access: { enabled: true, until_ms: 5n } });
    const before: number = Date.now();
    render(<TelemetrySection />);
    const sw: HTMLElement = await screen.findByRole('switch', { name: 'Allow Avarok support access' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.selectOptions(screen.getByLabelText('Access lasts'), '7');
    await userEvent.click(sw);
    await waitFor(() => expect(api.setSupportAccess).toHaveBeenCalledTimes(1));
    const [enabled, until] = api.setSupportAccess.mock.calls[0] as [boolean, bigint];
    expect(enabled).toBe(true);
    expect(until).toBeGreaterThanOrEqual(BigInt(before) + 7n * 86_400_000n);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
  });

  it('shows the server\'s refusal', async () => {
    api.setSupportAccess.mockRejectedValue(new Error('Permission denied: EditWorkspaceConfig required'));
    render(<TelemetrySection />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Allow Avarok support access' }));
    expect(await screen.findByText(/EditWorkspaceConfig required/)).toBeInTheDocument();
  });
});

describe('workspace terms and the access log', () => {
  it('saves new terms and says members will accept again', async () => {
    api.setWorkspaceTerms.mockResolvedValue({ platform: { version: 1, text: 'p' }, workspace: { version: 1, text: 'house rules' } });
    render(<TelemetrySection />);
    const box: HTMLElement = await screen.findByLabelText(/Workspace terms/);
    await waitFor(() => expect(box).toBeEnabled());
    await userEvent.type(box, 'house rules');
    await userEvent.click(screen.getByRole('button', { name: 'Save terms' }));
    await waitFor(() => expect(api.setWorkspaceTerms).toHaveBeenCalledWith('house rules'));
    expect(screen.getByText(/accept the terms again/)).toBeInTheDocument();
  });

  it('lists who read the logs, support by name', async () => {
    api.accessLog.mockResolvedValue([
      { at_ms: 1_700_000_000_000n, accessor: 'Support', filter: { user_id: null, peer_cid: null, min_level: null, since_ms: null, until_ms: null }, returned: 3 },
      { at_ms: 1_700_000_100_000n, accessor: { Member: { user_id: 'carol' } }, filter: { user_id: null, peer_cid: null, min_level: null, since_ms: null, until_ms: null }, returned: 1 },
    ]);
    render(<TelemetrySection />);
    const log: HTMLElement = await screen.findByTestId('telemetry-access-log');
    expect(log).toHaveTextContent('Avarok support');
    expect(log).toHaveTextContent('carol');
    expect(log).toHaveTextContent('1 line');
  });
});
