/**
 * What the picture viewer's stage says when it has no picture to draw: loading; why the file is
 * not readable here; or a photo the decoder refused, drawn with its RecoveryRoute surface so the
 * way on is a control (OK closes the viewer, Try again reloads), beside the enabled Download.
 */
import { RecoveryNotice } from '@/components/recovery-route/RecoveryNotice';
import { recovery, type Recovery } from '@/lib/recovery-route/recovery';
import { previewRefusalClause, type PhotoRefusal } from '@/lib/photo-decode/photo-refusal';
import type { PictureLoad } from '@/lib/received-files/picture-load';

interface PictureStageMessageProps {
  readonly load: PictureLoad | null;
  readonly onClose: () => void;
  readonly again: () => Promise<void>;
}

function refusalRecovery(refusal: PhotoRefusal, onClose: () => void, again: () => Promise<void>): Recovery {
  switch (refusal.kind) {
    case 'too-large': return recovery('photo.preview.too-large', { dismiss: onClose });
    case 'unsupported': return recovery('photo.preview.unsupported', { dismiss: onClose });
    case 'unreadable': return recovery('photo.preview.unreadable', { dismiss: onClose });
    case 'decoder-failed': return recovery('photo.preview.decoder-failed', { retry: again });
  }
}

export function PictureStageMessage({ load, onClose, again }: PictureStageMessageProps): JSX.Element {
  if (load !== null && 'refusal' in load) {
    return (
      <RecoveryNotice className="max-w-md p-6" recovery={refusalRecovery(load.refusal, onClose, again)}
        message={`This picture cannot be shown: ${previewRefusalClause(load.refusal)}.`} />
    );
  }
  return <p className="p-6 text-sm text-muted-foreground">{load !== null && 'unavailable' in load ? `This picture cannot be shown: ${load.unavailable}.` : 'Loading picture...'}</p>;
}
