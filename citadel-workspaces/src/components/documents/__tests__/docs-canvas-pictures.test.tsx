/**
 * The editing arm decides whether pictures can be inserted, and DocsCanvas hands that to the
 * ribbon: a chat document's reason disables Insert › Picture over the real runtime; a workspace
 * document's arm (a picture store) leaves it enabled.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { inProcessRuntime, type TestRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import DocsCanvas from '../DocsCanvas';
import type { DocumentEditing } from '../use-docs-document';
import { keepBlankReplica } from '../blank-replica';
import type { PicturePlan } from '@/lib/cdoc/pictures/picture-plan';
import { memoryPicturePlan, memoryPictures } from '@/lib/cdoc/pictures/__tests__/doubles/memory-pictures';
import { recordingDocumentFiles, type RecordingDocumentFiles } from '@/test-utils/recording-document-files';

// Any fixed instant: these tests download nothing.
const FILES: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
const REASON: string = 'No pictures in this one.';

async function pictureControl(pictures: PicturePlan): Promise<HTMLElement> {
  const runtime: TestRuntime = inProcessRuntime('main-thread');
  const editing: DocumentEditing = { kind: 'replica', keep: keepBlankReplica, save: null, pictures };
  render(<DocsCanvas documentSource={{ kind: 'blank' }} loadRuntime={async (): Promise<CdocRuntime> => runtime} editing={editing} statusBar={null} edit={{ enabled: true, reason: null }} commentAuthor="Ada" title="Untitled" files={FILES} original={null} />);
  const user: UserEvent = userEvent.setup();
  await user.click(await screen.findByTestId('docs-ribbon-tab-insert'));
  return screen.getByTestId('ribbon-insert-picture');
}

describe('DocsCanvas and pictures', () => {
  it('disables Insert › Picture with the editing arm\'s reason', async () => {
    expect(await pictureControl({ kind: 'none', reason: REASON })).toHaveAttribute('aria-disabled', 'true');
  });

  it('leaves it enabled where the arm allows pictures', async () => {
    expect(await pictureControl(memoryPicturePlan(memoryPictures(), { kind: 'page', nodeId: 'n' }))).toHaveAttribute('aria-disabled', 'false');
  });
});
