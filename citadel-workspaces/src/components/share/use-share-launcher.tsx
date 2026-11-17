/**
 * A Share action anywhere: `open` it on one thing, and render `dialog` beside the control.
 * Nothing loads until it opens, so a menu on every sidebar row costs one state slot each.
 *
 * React events bubble out of the dialog's portal to the control it was opened from; a sidebar row
 * ignores them (TreeRow acts only on clicks inside its own DOM and keys on itself).
 */
import { useState } from 'react';
import { syncForNewReaders } from '@/components/documents/save/sync-for-new-readers';
import type { ShareSubject } from '@/lib/share/share-target';
import { ShareLinkDialog } from './ShareLinkDialog';

export interface ShareLauncher {
  open: (subject: ShareSubject) => void;
  dialog: JSX.Element | null;
}

export function useShareLauncher(): ShareLauncher {
  const [subjects, setSubjects] = useState<ShareSubject[] | null>(null);
  return {
    open: (subject: ShareSubject): void => {
      // Sharing a document sends the edits this device holds of it, so whoever opens the link sees them.
      if (subject.kind === 'node') syncForNewReaders(subject.nodeId, subject.name);
      setSubjects([subject]);
    },
    dialog: subjects === null ? null : <ShareLinkDialog subjects={subjects} onClose={() => setSubjects(null)} />,
  };
}
