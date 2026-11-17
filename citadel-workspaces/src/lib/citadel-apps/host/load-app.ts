/**
 * From fetched bytes to a module an instance may run: integrity first (verify-artifact.ts, nothing
 * is compiled before it passes), then the ABI verdict (inspect.ts, nothing is instantiated before
 * it passes), then the memory the instance gets. Each refusal says which gate refused.
 */
import type { Capability } from './capabilities';
import { inspectArtifact, type LoadVerdict } from './inspect';
import { instanceMemoryFor, memoryMaxPagesFor, type HostPolicy } from './limits';
import { verifyArtifact, type ArtifactBundle, type ArtifactRefusal, type ArtifactVerdict, type ArtifactVerifierPort, type PinnedInstall } from './verify-artifact';

export interface LoadRequest {
  readonly install: PinnedInstall;
  readonly bundle: ArtifactBundle;
  /** The manifest's declared capabilities: the groups the module may import. */
  readonly declared: ReadonlySet<Capability>;
  readonly manifestMemoryPages: number;
  readonly policy: HostPolicy;
}

export type PreparedApp =
  | { readonly ok: true; readonly module: WebAssembly.Module; readonly memory: { readonly initialPages: number; readonly maxPages: number } }
  | { readonly ok: false; readonly gate: 'artifact'; readonly refusal: ArtifactRefusal }
  /** The Rust inspector's `Rejection::code()` strings, in its order. */
  | { readonly ok: false; readonly gate: 'abi'; readonly reasons: readonly string[] };

export async function prepareApp(request: LoadRequest, verifier: ArtifactVerifierPort): Promise<PreparedApp> {
  const integrity: ArtifactVerdict = await verifyArtifact(request.install, request.bundle, verifier);
  if (!integrity.ok) return { ok: false, gate: 'artifact', refusal: integrity.refusal };
  const hostMax: number = memoryMaxPagesFor(request.manifestMemoryPages, request.policy);
  const verdict: LoadVerdict = await inspectArtifact(request.bundle.wasm, request.declared, hostMax);
  if (!verdict.ok) return { ok: false, gate: 'abi', reasons: verdict.reasons };
  return { ok: true, module: verdict.module, memory: instanceMemoryFor(verdict.memory, request.manifestMemoryPages, request.policy) };
}
