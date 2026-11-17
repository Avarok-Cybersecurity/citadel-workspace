/**
 * The six states of the update panel, each with the one thing a person can do about it, and the
 * About card's honesty about what "verified" rests on. The agent is a recorder answering on the
 * app's event emitter; nothing in the panel is mocked.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UpdateStatusPanel } from '../UpdateStatusPanel';
import { AgentVersionCard } from '../AgentVersionCard';
import { ReleaseNotes } from '../ReleaseNotes';
import { useRestartToUpdate, type RestartControl } from '../use-restart-to-update';
import { deriveUpdateView, type UpdateView } from '@/lib/agent-update/update-view';
import { fromAvailable, type AgentUpdate, type UpdaterSettings } from '@/lib/agent-update/update-state';
import { available, fakeUpdater, RELEASE, type FakeUpdater } from '@/lib/agent-update/__tests__/fake-updater';

const settings = (over: Partial<UpdaterSettings> = {}): UpdaterSettings =>
  ({ current: '0.8.8', autoInstall: true, lastChecked: 1_790_000_000n, lastError: null, ...over });
const update = (ready: boolean, over: Partial<AgentUpdate> = {}): AgentUpdate => ({ ...(fromAvailable(available(ready)) as AgentUpdate), ...over });

function Panel(props: { s?: UpdaterSettings; u?: AgentUpdate | null; checking?: boolean; onCheck?: () => void }): JSX.Element {
  const restart: RestartControl = useRestartToUpdate();
  const s: UpdaterSettings = props.s ?? settings();
  const view: UpdateView = deriveUpdateView({ settings: s, update: props.u ?? null, checking: props.checking ?? false, error: null });
  return <UpdateStatusPanel view={view} settings={s} onCheck={props.onCheck ?? ((): void => undefined)} restart={restart} />;
}

describe('the update panel', () => {
  it('up to date: says so, when it last looked, and offers Check now', () => {
    render(<Panel />);
    expect(screen.getByTestId('agent-update-status')).toHaveAttribute('data-state', 'current');
    expect(screen.getAllByText('Citadel Agent is up to date')[0]).toBeInTheDocument();
    expect(screen.getByText(/Last checked .*\(.*\)\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeEnabled();
  });

  it('checking: busy, announced, and the button cannot be pressed twice', () => {
    render(<Panel checking />);
    expect(screen.getByTestId('agent-update-status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Checking for updates');
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  });

  it('available: version, size, and a download link that opens safely', () => {
    render(<Panel u={update(false, { sizeBytes: 52_428_800, notes: '- faster start' })} />);
    expect(screen.getAllByText('Version 0.9.0 is available')[0]).toBeInTheDocument();
    expect(screen.getByText(/Download size 50 MB/)).toBeInTheDocument();
    const link: HTMLElement = screen.getByTestId('agent-update-download');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('href', update(false).downloadUrl);
    expect(screen.getByText('faster start')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-update-restart')).toBeNull();
  });

  it('downloading: a progressbar with the agent\'s fraction', () => {
    render(<Panel u={update(false)} s={settings({ downloadProgress: 0.42 })} />);
    expect(screen.getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute('aria-valuenow', '42');
  });

  it('ready: explains the automatic install, and Restart to update asks the agent only after confirmation', async () => {
    const agent: FakeUpdater = fakeUpdater(available(true));
    agent.silent = true;
    render(<Panel u={update(true)} />);
    expect(screen.getByTestId('agent-update-ready-explainer')).toHaveTextContent(/next time no account is signed in/);
    fireEvent.click(screen.getByTestId('agent-update-restart'));
    expect(agent.asked).toEqual([]);
    fireEvent.click(await screen.findByTestId('agent-update-confirm'));
    await waitFor(() => expect(agent.asked.map(([v]) => v)).toEqual(['UpdateApply']));
    expect(screen.getByText('Restarting the agent…')).toBeInTheDocument();
  });

  it('returns focus to Restart to update when the confirmation is cancelled', async () => {
    fakeUpdater(available(true));
    render(<Panel u={update(true)} />);
    const button: HTMLElement = screen.getByTestId('agent-update-restart');
    button.focus();
    fireEvent.click(button);
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('ready with automatic installs off says it waits for the person', () => {
    render(<Panel u={update(true)} s={settings({ autoInstall: false })} />);
    expect(screen.getByTestId('agent-update-ready-explainer')).toHaveTextContent(/Automatic installs are off/);
  });

  it('error: the words, announced, and Retry runs the check again', () => {
    let checks: number = 0;
    render(<Panel s={settings({ lastError: 'GitHub could not be reached' })} onCheck={(): void => { checks++; }} />);
    expect(screen.getByText('GitHub could not be reached')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/did not finish\. GitHub could not be reached/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(checks).toBe(1);
  });
});

describe('release notes', () => {
  it('render markup as text, never as elements', () => {
    const { container } = render(<ReleaseNotes notes={'<img src=x onerror=alert(1)>\n- <b>bold</b>'} notesUrl={`${RELEASE}tag/agent-v0.9.0`} version="0.9.0" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });
  it('link only to this project\'s releases', () => {
    render(<ReleaseNotes notes="x" notesUrl="https://evil.example/notes" version="0.9.0" />);
    expect(screen.queryByTestId('agent-release-notes-link')).toBeNull();
  });
});

describe('the version card', () => {
  it('claims Sigstore and the platform signature, and ML-DSA only when the agent says it checked', () => {
    const { rerender } = render(<AgentVersionCard version="0.8.8" os="macOS" />);
    expect(screen.getByTestId('agent-verified-badge')).toHaveTextContent('Verified releases');
    expect(screen.getByTestId('agent-verification-basis')).toHaveTextContent('Sigstore + platform signature.');
    expect(screen.getByTestId('agent-verification-basis')).not.toHaveTextContent('ML-DSA');
    rerender(<AgentVersionCard version="0.8.8" os="macOS" mlDsaVerified />);
    expect(screen.getByTestId('agent-verification-basis')).toHaveTextContent('ML-DSA');
  });
  it('shows the channel only when there is one', () => {
    const { rerender } = render(<AgentVersionCard version="0.8.8" os="Linux" />);
    expect(screen.queryByText('Update channel')).toBeNull();
    rerender(<AgentVersionCard version="0.8.8" os="Linux" channel="beta" />);
    expect(screen.getByText('beta')).toBeInTheDocument();
  });
});
