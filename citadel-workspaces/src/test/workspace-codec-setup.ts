/**
 * The workspace codec, loaded once per test file from the binary the page serves: the same
 * module and the same initialisation the page uses (loadWorkspaceCodecFrom), with the bytes read
 * from public/ instead of fetched, since there is no server under vitest.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadWorkspaceCodecFrom, WORKSPACE_CODEC_WASM_URL } from 'citadel-workspace-client-ts';

await loadWorkspaceCodecFrom(readFileSync(resolve(__dirname, '../../public', `.${WORKSPACE_CODEC_WASM_URL}`)));
