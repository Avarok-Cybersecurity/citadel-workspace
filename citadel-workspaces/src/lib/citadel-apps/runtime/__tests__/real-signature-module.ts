/**
 * TEST HELPER: the real wasm client module (citadel-workspace-client-ts/pkg, the tracked build
 * the browser loads) with its ML-DSA export, instantiated in node, and the signed-app fixture
 * citadel-app-signature generates. The glue is imported from a copy because vitest.config.ts
 * stubs every module named like the wasm client (for the suites that only need its types).
 */
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sdkSource, type SdkSource } from '../../sdk/__tests__/sdk-paths';
import type { AppSignatureModule } from '../verifier';

export const WASM_PKG: SdkSource = sdkSource('CITADEL_WASM_CLIENT_PKG', '../citadel-workspace-client-ts/pkg');
export const SIGNED_APP: SdkSource = sdkSource('CITADEL_SIGNED_APP_FIXTURE', '../citadel-internal-service/citadel-app-signature/fixtures/signed-app.json');

export interface SignedApp {
  readonly app_id: string;
  readonly version: string;
  readonly manifest: string;
  readonly wasm_hex: string;
  readonly public_key_hex: string;
  readonly other_public_key_hex: string;
  readonly signature_hex: string;
  readonly wrong_domain_signature_hex: string;
}

export const signedApp = (): SignedApp => JSON.parse(readFileSync(SIGNED_APP.path, 'utf8')) as SignedApp;

interface Glue extends AppSignatureModule {
  readonly initSync: (options: { module: Uint8Array }) => unknown;
}

export async function realSignatureModule(): Promise<AppSignatureModule> {
  const glue: string = join(mkdtempSync(join(tmpdir(), 'app-signature-')), 'glue.mjs');
  copyFileSync(join(WASM_PKG.path, 'citadel_internal_service_wasm_client.js'), glue);
  const module: Glue = await import(/* @vite-ignore */ pathToFileURL(glue).href) as Glue;
  module.initSync({ module: new Uint8Array(readFileSync(join(WASM_PKG.path, 'citadel_internal_service_wasm_client_bg.wasm'))) });
  return module;
}
