/**
 * The browser adapters that load cdoc-wasm's two artefacts: each glue by dynamic import (its own
 * chunk) and its binary from its stable URL, compiled while it streams. The editor artefact is
 * loaded when a document opens; the PDF artefact only when a PDF is first written.
 */
import { CDOC_EDITOR_WASM_URL, CDOC_PDF_WASM_URL } from '../asset-urls';
import type { CdocWasm, PdfWasm } from './cdoc-wasm-api';
import type { ByteProgress } from '@/lib/app-loading/load-stage';
import { withByteProgress } from './progress-response';

/** `report` hears the binary's bytes as they arrive: the page shows them while a document opens. */
export async function loadCdocEditorWasm(report: (progress: ByteProgress) => void): Promise<CdocWasm> {
  const glue: typeof import('../../../../vendor/cdoc/cdoc_wasm_editor.js') = await import('../../../../vendor/cdoc/cdoc_wasm_editor.js');
  const binary: Promise<Response> = fetch(CDOC_EDITOR_WASM_URL).then((response: Response): Response => withByteProgress(response, report));
  await glue.default({ module_or_path: binary });
  return glue;
}

export async function loadCdocPdfWasm(): Promise<PdfWasm> {
  const glue: typeof import('../../../../vendor/cdoc/cdoc_wasm_pdf.js') = await import('../../../../vendor/cdoc/cdoc_wasm_pdf.js');
  await glue.default({ module_or_path: CDOC_PDF_WASM_URL });
  return glue;
}
