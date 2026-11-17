/**
 * A file manager file Citadel Docs reads opens in it: its bytes are read and imported by the
 * real engine (in-process runtime), the import report and pages appear, Back returns to the
 * folder and the original can still be downloaded. A macro-enabled file, another format, or a
 * file whose bytes cannot be read is said so plainly, never opened.
 *
 * The one double is the file manager's data source, the agent's side of PulledFileIO: its pull
 * and its ReadPulledFileChunk answers come from a fixture file in memory, as the agent's come
 * from its disk. The product's reader (agentFileReader, readPulledFile) runs unchanged over it.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { inProcessRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import { fixture } from '@/lib/cdoc/__tests__/files-rig';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import { recordingDocumentFiles } from '@/test-utils/recording-document-files';
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import { DocsFileScreen } from '../DocsFileScreen';
import { agentFileReader, opensInDocs, type WorkspaceFileReader } from '../docs-file-open';
import type { PulledFileIO } from '../pulled-file-reader';
import type { PulledChunk } from '@/types/revfs-intents';

const file = (name: string, fileState: RevfsFileState = RevfsFileState.Remote): RevfsNode => ({ name, path: `/Reports/${name}`, type: 'file', fileState, createdAt: 0, updatedAt: 0 });
/** An agent that has the fixture file on its disk once pulled, answering reads from it. */
function agentServing(bytes: Uint8Array): PulledFileIO & { pulls: number } {
  const agent: PulledFileIO & { pulls: number } = {
    pulls: 0,
    pull: async (): Promise<void> => { agent.pulls++; },
    readChunk: async (_node: RevfsNode, offset: bigint, maxLen: number): Promise<PulledChunk> => {
      if (agent.pulls === 0) throw new Error('no pulled file for this path');
      return { totalSize: BigInt(bytes.length), offset, data: bytes.slice(Number(offset), Number(offset) + maxLen) };
    },
  };
  return agent;
}
const fixtureReader = (name: string): WorkspaceFileReader => agentFileReader(agentServing(fixture(name)));

function screenFor(node: RevfsNode, reader: WorkspaceFileReader): { onBack: () => void; onDownload: () => void } {
  const onBack: Mock<() => void> = vi.fn();
  const onDownload: Mock<() => void> = vi.fn();
  render(
    <DocsFileScreen
      node={node} folderName="Reports" onBack={onBack} onDownload={onDownload} reader={reader}
      // Any fixed instant: nothing is downloaded here.
      files={recordingDocumentFiles('2026-10-18T00:00:00Z')}
      loadCdocRuntime={(): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread'))}
    />,
  );
  return { onBack, onDownload };
}

describe('a .docx from the file manager', () => {
  it('opens in Citadel Docs with its import report and its page, read only', async () => {
    screenFor(file('textutil.docx'), fixtureReader('textutil.docx'));
    expect(await screen.findByRole('group', { name: 'Page 1 of 1' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Opening textutil.docx' })).toHaveTextContent(/could not be carried over/);
    expect(screen.getByTestId('document-read-only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download as…' })).toBeInTheDocument();
  });

  it('goes back to its folder and still downloads the original', () => {
    const { onBack, onDownload }: { onBack: () => void; onDownload: () => void } = screenFor(file('textutil.docx'), fixtureReader('textutil.docx'));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Reports' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download original' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('pulls the file once, then reads it through the agent', async () => {
    const agent: PulledFileIO & { pulls: number } = agentServing(fixture('textutil.docx'));
    screenFor(file('textutil.docx'), agentFileReader(agent));
    expect(await screen.findByRole('group', { name: 'Page 1 of 1' })).toBeInTheDocument();
    expect(agent.pulls).toBe(1);
  });

  it('says why, under the file\'s name, when the agent refuses the read, and offers the download', async () => {
    const agent: PulledFileIO = { ...agentServing(fixture('textutil.docx')), readChunk: async (): Promise<PulledChunk> => { throw new Error('the pulled file has expired'); } };
    const { onDownload }: { onDownload: () => void } = screenFor(file('textutil.docx'), agentFileReader(agent));
    const unreadable: HTMLElement = await screen.findByTestId('docs-file-unreadable');
    expect(unreadable).toHaveTextContent('the pulled file has expired');
    expect(screen.queryByTestId('document-host')).toBeNull();
    fireEvent.click(within(unreadable).getByRole('button', { name: 'Download textutil.docx' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});

describe('files Citadel Docs does not open', () => {
  it('refuses a macro-enabled file under its name, with downloading it as the way on', () => {
    const { onDownload }: { onDownload: () => void } = screenFor(file('budget.docm'), fixtureReader('textutil.docx'));
    const refused: HTMLElement = screen.getByTestId('docs-file-refused');
    expect(within(refused).getByRole('heading', { name: 'budget.docm' })).toBeInTheDocument();
    expect(refused).toHaveTextContent('never runs or keeps macros');
    fireEvent.click(within(refused).getByRole('button', { name: 'Download budget.docm' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('document-host')).toBeNull();
  });

  it('refuses a .docx that holds macros under its name, with downloading it as the way on', async () => {
    const { onDownload }: { onDownload: () => void } = screenFor(file('sneaky.docx'), fixtureReader('poi-simple-macro.docm'));
    const refused: HTMLElement = await screen.findByTestId('page-view-refused');
    expect(within(refused).getByRole('heading', { name: 'sneaky.docx' })).toBeInTheDocument();
    expect(refused).toHaveTextContent('never runs or keeps');
    fireEvent.click(within(refused).getByRole('button', { name: 'Download sneaky.docx' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('names what it opens for another format', () => {
    screenFor(file('photo.png'), fixtureReader('textutil.docx'));
    expect(screen.getByTestId('docs-file-refused')).toHaveTextContent('this is a .png file');
  });

  it('offers Docs only for a stored file of a kind it reads', () => {
    expect(opensInDocs(file('plan.md'))).toBe(true);
    expect(opensInDocs(file('plan.md', RevfsFileState.ServerStored))).toBe(true);
    expect(opensInDocs(file('plan.md', RevfsFileState.Sent))).toBe(false);
    expect(opensInDocs(file('plan.md', RevfsFileState.Received))).toBe(false);
    expect(opensInDocs(file('plan.md', RevfsFileState.Hosted))).toBe(false);
    expect(opensInDocs(file('budget.docm'))).toBe(false);
    expect(opensInDocs({ name: 'Docs.md', path: '/Docs.md', type: 'directory', children: [], createdAt: 0, updatedAt: 0 })).toBe(false);
  });
});
