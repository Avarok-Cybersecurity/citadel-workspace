/**
 * What the download toast says is happening, by whose copy it is.
 *
 * It said "Your agent is fetching it from Thomas Braun" for the viewer's OWN
 * upload, which read as the wrong person's file. The bytes do live on the
 * peer's machine -- that is what peer storage is -- so the copy says so: it is
 * your file, retrieved from the copy they keep for you. A file the peer
 * uploaded can only be opened by their agent, so for that one the peer is the
 * sender.
 */
import { RevfsFileState } from '@/types/revfs-types';

export interface DownloadCopy {
  title: string;
  description: string;
}

export function downloadCopy(state: RevfsFileState | undefined, fileName: string, sourceLabel: string): DownloadCopy {
  switch (state) {
    case RevfsFileState.Remote:
      return {
        title: `Downloading ${fileName}…`,
        description: `Your agent is retrieving your file from the copy ${sourceLabel} keeps for you.`,
      };
    case RevfsFileState.Hosted:
      return {
        title: `Asking ${sourceLabel} for ${fileName}…`,
        description: `Only ${sourceLabel}'s agent can open it, so ${sourceLabel} sends it to you. They need to be online.`,
      };
    default:
      return {
        title: `Downloading ${fileName}…`,
        description: `Your agent is fetching it from ${sourceLabel}.`,
      };
  }
}
