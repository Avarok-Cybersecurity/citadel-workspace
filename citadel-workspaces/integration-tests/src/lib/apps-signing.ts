/**
 * The Compute Pool, signed for this run only (p2p-demo-design §4, owner decision OD1).
 *
 * A fresh 32-byte ML-DSA seed is made here, handed to the signer in its environment and nowhere
 * else: it is never printed, never written to a file, and gone when the process ends. The signer
 * (apps/first-party/signer, `cargo run`) checks the committed module against the manifest, writes
 * the publisher key into it, and signs. What it writes is what `ListingOffer::Signed` installs.
 *
 * The compiler is the one the app's own rust-toolchain.toml names, read here rather than restated,
 * so the CI step that pre-builds the signer and this call cannot drift apart.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getWorkspaceRoot } from './service-helpers.js';

export const COMPUTE_POOL_ID: string = 'net.avarok.compute-pool';
/** The signer's own name for the variable (apps/first-party/signer/src/main.rs `SEED_ENV`). */
const SEED_ENV: string = 'CITADEL_APP_SIGNING_SEED_HEX';

export interface SignedApp {
  readonly appId: string;
  readonly version: string;
  readonly publisherKey: string;
  /** The exact manifest bytes the signature covers. */
  readonly manifestBytes: Buffer;
  readonly signature: string;
  readonly wasm: Buffer;
  readonly artifactSha256: string;
  /** Every capability the manifest declares, by name. */
  readonly capabilities: readonly string[];
}

/** The parent repository: citadel-workspaces' parent. */
export function repoRoot(): string {
  return resolve(getWorkspaceRoot(), '..');
}

async function pinnedToolchain(appDir: string): Promise<string> {
  const text: string = await readFile(join(appDir, 'rust-toolchain.toml'), 'utf8');
  const channel: string | undefined = /^channel\s*=\s*"([^"]+)"\s*$/m.exec(text)?.[1];
  if (channel === undefined) throw new Error(`${appDir}/rust-toolchain.toml names no channel`);
  return channel;
}

function runSigner(toolchain: string, appDir: string, outDir: string, seedHex: string): Promise<void> {
  const signer: string = join(repoRoot(), 'apps', 'first-party', 'signer', 'Cargo.toml');
  const args: string[] = [`+${toolchain}`, 'run', '--locked', '--release', '--quiet', '--manifest-path', signer, '--', appDir, outDir];
  return new Promise<void>((done, fail) => {
    const child = spawn('cargo', args, { env: { ...process.env, [SEED_ENV]: seedHex }, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (e: Error) => fail(new Error(`the signer did not start: ${e.message}`)));
    child.on('exit', (code: number | null) => (code === 0 ? done() : fail(new Error(`the signer exited with ${String(code)}`))));
  });
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`the signed manifest's ${what} is not text`);
  return value;
}

function readSigned(manifestBytes: Buffer, signature: string, wasm: Buffer): SignedApp {
  const m: Record<string, unknown> = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>;
  const publisher: Record<string, unknown> = (m.publisher ?? {}) as Record<string, unknown>;
  const artifact: Record<string, unknown> = (m.artifact ?? {}) as Record<string, unknown>;
  const caps: unknown = m.capabilities;
  if (!Array.isArray(caps)) throw new Error('the signed manifest has no capability list');
  return {
    appId: text(m.id, 'id'),
    version: text(m.version, 'version'),
    publisherKey: text(publisher.mldsa65_public_key, 'publisher key'),
    manifestBytes,
    signature,
    wasm,
    artifactSha256: text(artifact.sha256, 'artifact digest'),
    capabilities: caps.map((c: unknown) => text((c as Record<string, unknown>).cap, 'capability name')),
  };
}

/** Sign the committed Compute Pool with a key that exists for this run only. */
export async function signComputePool(): Promise<SignedApp> {
  const appDir: string = join(repoRoot(), 'apps', 'first-party', 'compute-pool');
  const outDir: string = await mkdtemp(join(tmpdir(), 'compute-pool-signed-'));
  await runSigner(await pinnedToolchain(appDir), appDir, outDir, randomBytes(32).toString('hex'));
  const app: SignedApp = readSigned(
    await readFile(join(outDir, 'manifest.json')),
    (await readFile(join(outDir, 'app.mldsa.sig'), 'utf8')).trim(),
    await readFile(join(appDir, 'wasm', 'compute-pool.wasm')),
  );
  if (app.appId !== COMPUTE_POOL_ID) throw new Error(`signed ${app.appId}, not ${COMPUTE_POOL_ID}`);
  console.log(`  Signed ${app.appId} ${app.version} with a key made for this run`);
  return app;
}
