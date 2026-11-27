/** The one gate every picture preview in the page reads and decodes through (preview-gate.ts). */
import { MAX_IN_FLIGHT_PREVIEW_BYTES } from './image-preview';
import { createPreviewGate, type PreviewGate } from './preview-gate';

export const previewGate: PreviewGate = createPreviewGate(MAX_IN_FLIGHT_PREVIEW_BYTES);
