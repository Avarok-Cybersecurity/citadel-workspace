/**
 * The only way to learn the native picker works is to try it.
 *
 * `nativePickerAvailable` becomes `false` when the picker reports
 * "native-dialogs feature is disabled" or "File picker not available". Nothing
 * ever sets it true, because there is no moment at which the app learns it
 * works — only moments at which it learns it does not. The type says
 * `false | null` now so a reader cannot write `=== true` and get a control that
 * never renders.
 *
 * Which makes the reading idiom load-bearing: `!== false` offers an unknown
 * picker, and `=== true` would hide it for everyone, permanently. This campaign
 * has shipped both halves of that mistake, so it is worth a test rather than a
 * convention.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileDropZone } from '../FileDropZone';

const noop = (): void => {};

function zone(nativePickerAvailable: false | null): void {
  render(
    <FileDropZone
      isDragging={false}
      isSending={false}
      isPickingFile={false}
      nativePickerAvailable={nativePickerAvailable}
      maxFileSizeBytes={1024}
      formatBytes={(b: number): string => `${b} B`}
      onDrop={noop}
      onDragOver={noop}
      onDragLeave={noop}
      onBrowseClick={noop}
      onNativePickerClick={noop}
      selectedFile={null}
      previewUrl={null}
      onRemoveFile={noop}
    />,
  );
}

describe('the file picker offer', () => {
  it('offers the native picker while nothing is known', () => {
    zone(null);
    expect(screen.getByText('Browse Files')).toBeTruthy();
  });

  it('withdraws it once the picker has refused', () => {
    // The positive control for the test above: a zone that always showed the
    // button would satisfy it while offering a control that cannot work.
    zone(false);
    expect(screen.queryByText('Browse Files')).toBeNull();
  });

  it('keeps the drag-and-drop browse either way, which the refusal points at', () => {
    // The error text says "Use drag & drop or browse instead", and this is the
    // browse it means. Hiding both would make that advice false.
    zone(false);
    expect(screen.getByText(/drop file here or/i)).toBeTruthy();
  });
});
