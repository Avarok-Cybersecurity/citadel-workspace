import { Monitor, Cloud, Upload, Download } from "lucide-react";
import { RevfsFileState, type RevfsNode } from "@/types/revfs-types";
import { getExtension } from '@/lib/revfs/tree-queries';

/** The two orders the address bar offers: by name, or by when it last changed. */
export type SortField = 'name' | 'date';
export type SortDirection = 'asc' | 'desc';

/** Folders first, then the chosen order. */
export function sortItems(items: readonly RevfsNode[], field: SortField, direction: SortDirection): RevfsNode[] {
  return [...items].sort((a: RevfsNode, b: RevfsNode): number => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    const cmp: number = field === 'name' ? a.name.localeCompare(b.name) : a.updatedAt - b.updatedAt;
    return direction === 'asc' ? cmp : -cmp;
  });
}


/** The lucide icon component a file state is marked with. */
type FileIcon = typeof Monitor;

export interface FileStateStyle {
  icon: FileIcon;
  color: string;
  title: string;
}

export const stateConfig: Record<RevfsFileState, FileStateStyle> = {
  [RevfsFileState.Hosted]: { icon: Monitor, color: 'text-muted-foreground', title: 'Hosted (stored for peer)' },
  [RevfsFileState.Remote]: { icon: Cloud, color: 'text-primary-accent', title: 'Remote (downloadable)' },
  [RevfsFileState.Sent]: { icon: Upload, color: 'text-success-emphasis', title: 'Sent' },
  [RevfsFileState.Received]: { icon: Download, color: 'text-primary-accent', title: 'Received' },
  [RevfsFileState.ServerStored]: { icon: Cloud, color: 'text-muted-foreground', title: 'Server stored (downloadable)' },
};

/**
 * Why a file or folder name is unusable, or null. Shared by rename and New
 * folder: New folder never checked, so "a/b" was read as a path and refused as
 * "Parent directory not found: /a", about a folder nobody asked for.
 */
export function entryNameError(name: string): string | null {
  if (!name.trim()) return 'Name cannot be empty';
  if (name.includes('/') || name.includes('\\')) return 'Name cannot contain slashes';
  if (name === '.' || name === '..') return 'Invalid name';
  if (name.length > 255) return 'Name too long';
  return null;
}

/**
 * The coloured extension badge on every file, and the kind it names.
 *
 * One table of tones, by family. Each is a fill that carries white 10px bold
 * text at AA (a-file-badge-is-readable computes the ratio from these values),
 * so it reads the same on the light and dark themes and needs no pair.
 */
export const FILE_BADGE_TONES = {
  pdf: 'bg-[hsl(0_72%_42%)]',
  cad: 'bg-[hsl(180_80%_24%)]',
  slides: 'bg-[hsl(20_85%_37%)]',
  image: 'bg-[hsl(265_55%_48%)]',
  sheet: 'bg-[hsl(140_65%_27%)]',
  document: 'bg-[hsl(218_75%_45%)]',
  text: 'bg-[hsl(215_20%_38%)]',
  archive: 'bg-[hsl(36_90%_28%)]',
  other: 'bg-[hsl(235_12%_38%)]',
} as const;

export type BadgeFamily = keyof typeof FILE_BADGE_TONES;

interface Family {
  family: BadgeFamily;
  kind: string;
}

const FAMILIES: Readonly<Record<string, Family>> = {
  pdf: { family: 'pdf', kind: 'PDF document' },
  dwg: { family: 'cad', kind: 'AutoCAD drawing' },
  dxf: { family: 'cad', kind: 'CAD drawing' },
  ppt: { family: 'slides', kind: 'PowerPoint presentation' },
  pptx: { family: 'slides', kind: 'PowerPoint presentation' },
  key: { family: 'slides', kind: 'Keynote presentation' },
  jpg: { family: 'image', kind: 'JPEG image' },
  jpeg: { family: 'image', kind: 'JPEG image' },
  png: { family: 'image', kind: 'PNG image' },
  gif: { family: 'image', kind: 'GIF image' },
  webp: { family: 'image', kind: 'WebP image' },
  svg: { family: 'image', kind: 'SVG image' },
  csv: { family: 'sheet', kind: 'CSV spreadsheet' },
  xls: { family: 'sheet', kind: 'Excel spreadsheet' },
  xlsx: { family: 'sheet', kind: 'Excel spreadsheet' },
  doc: { family: 'document', kind: 'Word document' },
  docx: { family: 'document', kind: 'Word document' },
  dotx: { family: 'document', kind: 'Word template' },
  odt: { family: 'document', kind: 'OpenDocument text' },
  md: { family: 'text', kind: 'Markdown document' },
  txt: { family: 'text', kind: 'Text document' },
  zip: { family: 'archive', kind: 'ZIP archive' },
  gz: { family: 'archive', kind: 'Compressed archive' },
  tar: { family: 'archive', kind: 'TAR archive' },
  '7z': { family: 'archive', kind: '7-Zip archive' },
  rar: { family: 'archive', kind: 'RAR archive' },
};

/** Four letters fit the badge at its 10px size. */
const LABEL_LENGTH: number = 4;

export interface FileBadge {
  label: string;
  tone: string;
}

export function fileBadge(name: string): FileBadge {
  const ext: string = getExtension(name).toLowerCase();
  if (ext === '') return { label: 'FILE', tone: FILE_BADGE_TONES.other };
  const family: BadgeFamily = FAMILIES[ext]?.family ?? 'other';
  return { label: ext.slice(0, LABEL_LENGTH).toUpperCase(), tone: FILE_BADGE_TONES[family] };
}

export function fileKind(name: string): string {
  const ext: string = getExtension(name).toLowerCase();
  if (ext === '') return 'File';
  return FAMILIES[ext]?.kind ?? `${ext.toUpperCase()} file`;
}
