/**
 * The download toast names whose file it is and who is sending it.
 *
 * Live: Alexi downloading her OWN upload was told "Your agent is fetching it
 * from Thomas Braun" and read it as Thomas's file. The bytes are on Thomas's
 * machine -- that is peer storage -- so the toast now says it is her file, from
 * the copy he keeps for her. For a file Thomas uploaded, Thomas is the sender.
 */
import { describe, it, expect } from 'vitest';
import { RevfsFileState } from '@/types/revfs-types';
import { downloadCopy, type DownloadCopy } from '../download-copy';

describe('the download toast', () => {
  it('calls your own upload yours', () => {
    const copy: DownloadCopy = downloadCopy(RevfsFileState.Remote, 'scan.png', 'Thomas Braun');
    expect(copy.description).toBe('Your agent is retrieving your file from the copy Thomas Braun keeps for you.');
  });

  it('names the uploader as the sender of their file', () => {
    const copy: DownloadCopy = downloadCopy(RevfsFileState.Hosted, 'atlas.png', 'Thomas Braun');
    expect(copy.title).toBe('Asking Thomas Braun for atlas.png…');
    expect(copy.description).toMatch(/^Only Thomas Braun's agent can open it/);
  });

  it('keeps naming the server for server storage', () => {
    expect(downloadCopy(RevfsFileState.ServerStored, 'a.txt', 'Server').description).toBe('Your agent is fetching it from Server.');
  });
});
