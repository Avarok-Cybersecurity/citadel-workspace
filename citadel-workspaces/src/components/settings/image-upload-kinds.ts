/**
 * What an image uploader is uploading: a profile picture or a workspace icon.
 *
 * One uploader (AvatarUpload) serves both. The kind decides the size the image is resized to,
 * the shape it is previewed in, and what screen readers call it.
 */
import { Building2, User, type LucideIcon } from 'lucide-react';

export interface ImageUploadKind {
  /** Longest side after resizing, in pixels. */
  maxDimension: number;
  shape: 'circle' | 'rounded';
  placeholder: LucideIcon;
  labels: { upload: string; change: string; remove: string; previewAlt: string };
}

export const PROFILE_PICTURE: ImageUploadKind = {
  maxDimension: 256,
  shape: 'circle',
  placeholder: User,
  labels: { upload: 'Upload profile picture', change: 'Change profile picture', remove: 'Remove avatar', previewAlt: 'Avatar preview' },
};

/** 128 px: shown at 32 px in the switcher, and stored in the workspace record every member receives. */
export const WORKSPACE_ICON: ImageUploadKind = {
  maxDimension: 128,
  shape: 'rounded',
  placeholder: Building2,
  labels: { upload: 'Upload workspace icon', change: 'Change workspace icon', remove: 'Remove workspace icon', previewAlt: 'Workspace icon preview' },
};
