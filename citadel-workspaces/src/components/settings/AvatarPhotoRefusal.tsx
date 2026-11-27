/**
 * A photo the avatar picker could not convert, drawn with its RecoveryRoute surface: choose
 * another photo (the picker opens), or, when the converter itself failed, try the same one again.
 */
import { RecoveryNotice } from '@/components/recovery-route/RecoveryNotice';
import { recovery, type Recovery } from '@/lib/recovery-route/recovery';
import { avatarRefusalSentence, type PhotoRefusal } from '@/lib/photo-decode/photo-refusal';
import { MAX_PREVIEW_PIXELS } from '@/lib/received-files/image-preview';

interface AvatarPhotoRefusalProps {
  readonly refusal: PhotoRefusal;
  readonly chooseAnother: () => void;
  readonly again: () => Promise<void>;
}

function refusalRecovery(refusal: PhotoRefusal, chooseAnother: () => void, again: () => Promise<void>): Recovery {
  switch (refusal.kind) {
    case 'too-large': return recovery('photo.avatar.too-large', { focus: chooseAnother });
    case 'unsupported': return recovery('photo.avatar.unsupported', { focus: chooseAnother });
    case 'unreadable': return recovery('photo.avatar.unreadable', { focus: chooseAnother });
    case 'decoder-failed': return recovery('photo.avatar.decoder-failed', { retry: again, focus: chooseAnother });
  }
}

export function AvatarPhotoRefusal({ refusal, chooseAnother, again }: AvatarPhotoRefusalProps): JSX.Element {
  return (
    <RecoveryNotice className="max-w-xs text-center text-xs" recovery={refusalRecovery(refusal, chooseAnother, again)}
      message={avatarRefusalSentence(refusal, MAX_PREVIEW_PIXELS)} />
  );
}
