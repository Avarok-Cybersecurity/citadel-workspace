/**
 * Someone new can read `nodeId` (shared, or granted access in member management): send the
 * edits this device holds of it, so what they open includes them. Failure is reported, not
 * swallowed: the edits stay on this device and the person is told so.
 */
import { toast } from 'sonner';
import { requestDocumentSync } from '@/lib/document-sync-requests';

export function syncForNewReaders(nodeId: string, name: string): void {
  void requestDocumentSync({ nodeId, chatDoc: null }).catch((error: unknown): void => {
    toast.error(`Your unsent edits to ${name} are still only on this device. ${error instanceof Error ? error.message : String(error)}`);
  });
}
