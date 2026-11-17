/**
 * A screen reader hears an upload start, each quarter of it, and how it ended, not every chunk: a
 * 4 MiB file is sixteen chunks, and sixteen announcements drown out the conversation.
 */
import { describe, it, expect } from 'vitest';
import { announcement, uploadPercent, type ServerUpload, type UploadingFile } from '../server-upload';

const uploading = (stored: number, total: number): UploadingFile => ({ kind: 'uploading', name: 'plan.pdf', storedBytes: stored, totalBytes: total });

function said(steps: readonly ServerUpload[]): string[] {
  const heard: string[] = [];
  steps.reduce((previous: ServerUpload | null, next: ServerUpload): ServerUpload => {
    const text: string | null = announcement(previous, next);
    if (text !== null) heard.push(text);
    return next;
  }, null);
  return heard;
}

describe('what an upload announces', () => {
  it('says the start, each quarter and the share, once each, over sixteen chunks', () => {
    const chunks: ServerUpload[] = Array.from({ length: 17 }, (_: unknown, i: number): ServerUpload => uploading(i, 16));
    expect(said([...chunks, { kind: 'shared', name: 'plan.pdf' }])).toEqual([
      'Uploading plan.pdf',
      'plan.pdf: 25 percent uploaded',
      'plan.pdf: 50 percent uploaded',
      'plan.pdf: 75 percent uploaded',
      'plan.pdf is shared with the channel',
    ]);
  });

  it('says why the server refused it', () => {
    expect(said([uploading(0, 4), { kind: 'refused', name: 'plan.pdf', reason: "The workspace's storage is full." }]))
      .toEqual(['Uploading plan.pdf', "plan.pdf was not shared. The workspace's storage is full."]);
  });

  it('starts counting again for the next file', () => {
    expect(said([uploading(0, 4), uploading(3, 4), { kind: 'uploading', name: 'b.txt', storedBytes: 0, totalBytes: 4 }])).toEqual([
      'Uploading plan.pdf', 'plan.pdf: 75 percent uploaded', 'Uploading b.txt',
    ]);
  });

  it('calls an empty file whole', () => {
    expect(uploadPercent(uploading(0, 0))).toBe(100);
    expect(uploadPercent(uploading(1, 3))).toBe(33);
  });
});
