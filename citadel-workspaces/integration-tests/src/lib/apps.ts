/**
 * Apps for the Compute Pool spec: install a signed app, answer the per-member prompts, block a
 * peer, and read what the app says.
 *
 * INSTALL PATH. The marketplace has no way to upload a `ListingOffer::Signed` (AppsBrowse lists
 * only the catalogue and this workspace's registry), so the install goes through the page's own
 * apps transport: `sessionAppsTransport`, the serial wrapper every apps request on a tab uses,
 * with `UploadArtifactChunk` for the module and `Install` for the signed manifest. The modules are
 * loaded by their dev-server URL, which is the instance the app itself imported.
 *
 * CONSENT is the member's own, through the Installed list (InstalledApps / PeerConsentPanel), and
 * is judged by each plane's `data-allowed` changing, never by a toast.
 *
 * THE LOG is the app's `LogWrite` lines as page-runtime.ts prints them (`[app <level>] <message>`)
 * plus the runtime's zone audit (`[apps] ...`), collected from the console as they arrive.
 */
import type { Locator, Page } from 'playwright';
import { expect } from '@playwright/test';
import { pressAccountMenuItem } from './account-menu.js';
import { formatConsoleLine } from './console-line.js';
import type { SignedApp } from './apps-signing.js';

/** `citadel-workspace-types` ARTIFACT_CHUNK_BYTES; the server refuses any other split. */
const ARTIFACT_CHUNK_BYTES: number = 256 * 1024;
const UI_MS: number = 30_000;

export type Plane = 'serve' | 'call' | 'topics';
type Path = ReadonlyArray<string>;
interface AskSpec { request: unknown; key: string; match: ReadonlyArray<[Path, string | number]>; pick: Path }
type AskOutcome = { ok: true; picked: string } | { ok: false; why: string };

/** One apps request on the page's own transport; the answer's `key` variant whose `match` fields agree is ours. */
async function askApps(page: Page, spec: AskSpec): Promise<AskOutcome> {
  return page.evaluate(async (s: AskSpec): Promise<AskOutcome> => {
    type Transport = { request: (r: unknown, ours: (a: { kind: string }) => boolean) => Promise<{ kind: string }> };
    type Emitter = { on: (event: string, h: (p: { answer: unknown }) => void) => () => void };
    const load = (url: string): Promise<unknown> => import(url);
    const { sessionAppsTransport } = (await load('/src/lib/citadel-apps/apps-api.ts')) as { sessionAppsTransport: Transport };
    const { eventEmitter } = (await load('/src/lib/event-emitter.ts')) as { eventEmitter: Emitter };
    const at = (v: unknown, path: Path): unknown => path.reduce((o: unknown, k: string) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined), v);
    let last: unknown = null;
    // 'workspace:apps' is emitted before the raw response the transport waits on, so `last` is current.
    const off: () => void = eventEmitter.on('workspace:apps', (p: { answer: unknown }) => { last = p.answer; });
    const ours = (): unknown => {
      const body: unknown = at(last, [s.key]);
      return body !== undefined && s.match.every(([path, want]) => at(body, path) === want) ? body : undefined;
    };
    try {
      const answer: { kind: string } = await sessionAppsTransport.request(s.request, (a: { kind: string }) => a.kind === 'refused' || ours() !== undefined);
      const body: unknown = ours();
      const refusal: unknown = at(last, ['Refused']);
      const named: string = typeof refusal === 'object' && refusal !== null ? Object.keys(refusal).join(',') : String(refusal ?? answer.kind);
      if (answer.kind === 'refused' || body === undefined) return { ok: false, why: `refused: ${named}` };
      return { ok: true, picked: String(at(body, s.pick)) };
    } catch (e: unknown) {
      return { ok: false, why: `no answer: ${String(e)}` };
    } finally {
      off();
    }
  }, spec);
}

async function uploadArtifact(page: Page, app: SignedApp): Promise<void> {
  const total: number = Math.ceil(app.wasm.length / ARTIFACT_CHUNK_BYTES);
  for (let index = 0; index < total; index++) {
    const bytes: number[] = Array.from(app.wasm.subarray(index * ARTIFACT_CHUNK_BYTES, (index + 1) * ARTIFACT_CHUNK_BYTES));
    const out: AskOutcome = await askApps(page, {
      request: { UploadArtifactChunk: { sha256: app.artifactSha256, index, total_chunks: total, bytes } },
      key: 'ArtifactChunkStored', match: [[['sha256'], app.artifactSha256], [['index'], index]], pick: ['index'],
    });
    if (!out.ok) throw new Error(`chunk ${index + 1}/${total} of ${app.appId} was not stored (${out.why})`);
  }
}

/**
 * Upload the module and install the signed manifest for the whole workspace, granting every
 * capability it declares except `withhold`. Answers the install id.
 */
export async function installSignedApp(page: Page, app: SignedApp, withhold: readonly string[]): Promise<string> {
  await uploadArtifact(page, app);
  const granted: string[] = app.capabilities.filter((c: string) => !withhold.includes(c));
  const out: AskOutcome = await askApps(page, {
    request: { Install: {
      app_id: app.appId, version: app.version, scope: 'Workspace', granted, pinned_publisher_key: app.publisherKey, inject_requirement: false,
      listing: { Signed: { manifest_bytes: Array.from(app.manifestBytes), signature: app.signature } },
    } },
    key: 'Installed', match: [[['install', 'app_id'], app.appId], [['install', 'version'], app.version]], pick: ['install', 'id'],
  });
  if (!out.ok) throw new Error(`${app.appId} was not installed (${out.why})`);
  console.log(`  Installed ${app.appId} as ${out.picked}, withholding [${withhold.join(', ')}]`);
  return out.picked;
}

/** Uninstall, purging its storage: the spec's installs are its own. */
export async function uninstallApp(page: Page, installId: string): Promise<void> {
  const out: AskOutcome = await askApps(page, {
    request: { Uninstall: { install_id: installId, purge_storage: true } }, key: 'Uninstalled', match: [[['install_id'], installId]], pick: ['install_id'],
  });
  if (!out.ok) throw new Error(`install ${installId} was not removed (${out.why})`);
}

/** The Apps modal on the Installed tab, with the install's direct-connections panel open. */
async function openPeerPanel(page: Page, installId: string): Promise<Locator> {
  await pressAccountMenuItem(page, 'account-menu-apps');
  const modal: Locator = page.getByTestId('apps-modal');
  await expect(modal).toBeVisible({ timeout: UI_MS });
  await modal.getByTestId('apps-tab-installed').click();
  const row: Locator = modal.locator(`[data-testid="apps-installed-row"][data-install-id="${installId}"]`);
  await expect(row).toBeVisible({ timeout: UI_MS });
  const panel: Locator = row.getByTestId('apps-peer-consent');
  // The toggle opens a closed panel and would close an open one: its aria-expanded says which it is.
  const toggle: Locator = row.getByTestId('apps-installed-peer-toggle');
  await expect(toggle).toBeVisible({ timeout: UI_MS });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(panel).toBeVisible({ timeout: UI_MS });
  return panel;
}

async function closeApps(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('apps-modal')).toBeHidden({ timeout: UI_MS });
}

async function setPlane(panel: Locator, plane: Plane, allowed: boolean): Promise<void> {
  const ask: Locator = panel.locator(`[data-testid="apps-peer-ask"][data-plane="${plane}"]`);
  await expect(ask).toBeVisible({ timeout: UI_MS });
  const want: string = String(allowed);
  const now: string | null = await ask.getAttribute('data-allowed');
  if (now === want) return;
  if (!allowed && now === 'null') throw new Error(`${plane} was never allowed, so it cannot be revoked`);
  await ask.getByTestId(`apps-peer-allow-${plane}`).click();
  await expect(ask).toHaveAttribute('data-allowed', want, { timeout: UI_MS });
}

/** Allow `planes` for this member; the P2P planes must say what the server sees. */
export async function consentPeer(page: Page, installId: string, planes: readonly Plane[]): Promise<void> {
  const panel: Locator = await openPeerPanel(page, installId);
  for (const plane of planes) await setPlane(panel, plane, true);
  if (planes.some((p: Plane) => p !== 'topics')) await expect(panel.getByTestId('apps-peer-disclosure').first()).toBeVisible({ timeout: UI_MS });
  await closeApps(page);
}

export async function revokePeer(page: Page, installId: string, plane: Plane): Promise<void> {
  const panel: Locator = await openPeerPanel(page, installId);
  await setPlane(panel, plane, false);
  await closeApps(page);
}

/** Block (or unblock) `username` from reaching this member through the install. */
export async function blockPeer(page: Page, installId: string, username: string, block: boolean): Promise<void> {
  const panel: Locator = await openPeerPanel(page, installId);
  const row: Locator = panel.locator(`[data-testid="apps-peer-blocked-row"][data-username="${username}"]`);
  if (block) {
    await panel.getByTestId('apps-peer-block-input').fill(username);
    await panel.getByTestId('apps-peer-block').click();
    await expect(row).toBeVisible({ timeout: UI_MS });
  } else {
    await expect(row).toBeVisible({ timeout: UI_MS });
    await row.getByTestId('apps-peer-unblock').click();
    // Settling the panel only; what proves the unblock is the next call that gets through.
    await expect(row).toBeHidden({ timeout: UI_MS });
  }
  await closeApps(page);
}

export interface ZoneLog {
  readonly lines: readonly string[];
  /** The first line at or after index `from` matching `re`, waiting up to `timeoutMs`; null if none came. */
  readonly find: (re: RegExp, from: number, timeoutMs: number) => Promise<RegExpExecArray | null>;
}

/** Collect the app and zone lines this page prints, from now on. */
export function readZoneLog(page: Page, label: string): ZoneLog {
  const lines: string[] = [];
  const waiters: Set<() => void> = new Set<() => void>();
  page.on('console', (msg): void => {
    const line: string = msg.text();
    if (!line.startsWith('[app ') && !line.startsWith('[apps] ')) return;
    lines.push(line);
    console.log(`  [${label}] ${formatConsoleLine(line)}`);
    for (const wake of [...waiters]) wake();
  });
  const find = (re: RegExp, from: number, timeoutMs: number): Promise<RegExpExecArray | null> => new Promise((resolve) => {
    const scan = (): RegExpExecArray | null => {
      for (let i = from; i < lines.length; i++) {
        const m: RegExpExecArray | null = new RegExp(re.source, re.flags.replace('g', '')).exec(lines[i]);
        if (m !== null) return m;
      }
      return null;
    };
    const finish = (m: RegExpExecArray | null): void => { waiters.delete(wake); clearTimeout(timer); resolve(m); };
    const wake = (): void => { const m: RegExpExecArray | null = scan(); if (m !== null) finish(m); };
    const timer: NodeJS.Timeout = setTimeout(() => finish(null), timeoutMs);
    waiters.add(wake);
    wake();
  });
  return { lines, find };
}
