/**
 * TEST HELPER: where the Rust SDK's outputs live. In the monorepo they sit beside this UI
 * (`../citadel-internal-service/...`, `../apps/sdk-fixtures`); an env var points elsewhere (a
 * separate worktree). A test that needs one and cannot find it skips with the path it looked
 * at in its name, so an absent source is visible in every run rather than a silent pass.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** citadel-workspaces/, from src/lib/citadel-apps/sdk/__tests__/. */
const UI_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

export interface SdkSource {
  readonly path: string;
  readonly present: boolean;
  /** For the test name: what a skip means. */
  readonly label: string;
}

export function sdkSource(envVar: string, fromUiRoot: string): SdkSource {
  const fromEnv: string | undefined = process.env[envVar];
  const path: string = fromEnv !== undefined && fromEnv !== '' ? resolve(fromEnv) : resolve(UI_ROOT, fromUiRoot);
  const present: boolean = existsSync(path);
  return { path, present, label: present ? path : `SKIPPED: ${path} is absent (set ${envVar})` };
}

export const BINDINGS: SdkSource = sdkSource('CITADEL_APP_SDK_BINDINGS', '../citadel-internal-service/citadel-app-sdk-types/bindings');
export const FIXTURES: SdkSource = sdkSource('CITADEL_APP_SDK_FIXTURES', '../apps/sdk-fixtures');
export const GENERATED_COPY: string = resolve(UI_ROOT, 'src/lib/citadel-apps/sdk/generated');
/** The internal-HTTP wire's bindings (citadel-ihttp-types), and the page's copy of them. */
export const WIRE_BINDINGS: SdkSource = sdkSource('CITADEL_IHTTP_BINDINGS', '../citadel-internal-service/citadel-ihttp-types/bindings');
export const WIRE_GENERATED_COPY: string = resolve(UI_ROOT, 'src/lib/citadel-apps/sdk/wire-generated');
