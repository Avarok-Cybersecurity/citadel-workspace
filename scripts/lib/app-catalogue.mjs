/**
 * The global app catalogue's checks, over injected rules and I/O so the tests drive the same code
 * the gate runs:
 *
 *   - the file and each entry read under the UI's rules (shape, manifest rules, id and version
 *     matching the manifest, one entry per id) -- `rules.readCatalogue`;
 *   - each entry's signature, through `verifySignature(entry, manifest)`, which answers 'valid',
 *     'invalid' or 'unchecked' (where no verifier runs, the count of unchecked ones is reported);
 *   - each module's imports against what its manifest declares, where the module is to hand
 *     (`artifactFor(manifest)` answers its bytes or null) and the ABI's constants are (`abi`):
 *     the bytes must hash to the manifest's artifact.sha256, every import must be in the ABI's
 *     namespace, and each group imported must be opened by a declared or intrinsic capability.
 */
import { createHash } from 'node:crypto';

/** Imports every module may make whatever it declares. */
const ALWAYS_IMPORTABLE = new Set(['memory', 'reply_len', 'reply_read']);

/** The ABI constants as citadel-app-sdk-types generates them (bindings/AbiConstants.ts). */
export function readAbiConstants(text) {
  const namespace = /export const ABI_NAMESPACE = "([^"]+)"/.exec(text)?.[1];
  const intrinsic = /export const INTRINSIC_CAPABILITIES = \[([^\]]*)\]/.exec(text)?.[1];
  const groups = /export const CAPABILITY_GROUP[^=]*= \{([^}]*)\}/.exec(text)?.[1];
  if (namespace === undefined || intrinsic === undefined || groups === undefined) return null;
  const capabilityGroup = Object.fromEntries([...groups.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
  if (Object.keys(capabilityGroup).length === 0) return null;
  return { namespace, intrinsic: [...intrinsic.matchAll(/"([^"]+)"/g)].map((m) => m[1]), capabilityGroup };
}

/** Why a module's imports are not what its manifest declares; empty when they are. */
export function importProblems(bytes, manifest, abi) {
  const problems = [];
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== manifest.artifact.sha256) return [`the module hashes to ${hash}, not the manifest's ${manifest.artifact.sha256}`];
  let imports;
  try {
    imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
  } catch (error) {
    return [`the module does not compile: ${error.message}`];
  }
  const groups = new Set(Object.values(abi.capabilityGroup));
  const declared = [...manifest.capabilities.map((c) => c.cap), ...abi.intrinsic];
  const opened = new Set(declared.map((c) => abi.capabilityGroup[c]));
  for (const imp of imports) {
    if (imp.module !== abi.namespace) problems.push(`imports ${imp.module}.${imp.name}, outside ${abi.namespace}`);
    else if (ALWAYS_IMPORTABLE.has(imp.name)) continue;
    else if (!groups.has(imp.name)) problems.push(`imports "${imp.name}", which is not an ABI group`);
    else if (!opened.has(imp.name)) problems.push(`imports the "${imp.name}" group but declares no capability that opens it`);
  }
  return problems;
}

/**
 * Every problem with the catalogue `text`, and what was examined:
 * `{ problems, entries, signatures: { valid, unchecked }, modules: { checked, notToHand } }`.
 */
export function checkCatalogue(text, { rules, verifySignature, artifactFor, abi }) {
  const reading = rules.readCatalogue(text);
  const result = { problems: [], entries: 0, signatures: { valid: 0, unchecked: 0 }, modules: { checked: 0, notToHand: 0 } };
  if (!reading.ok) {
    result.problems.push(`the catalogue is refused: ${reading.why}`);
    return result;
  }
  result.problems.push(...reading.problems);
  for (const { entry, manifest } of reading.entries) {
    result.entries += 1;
    const verdict = verifySignature(entry, manifest);
    if (verdict === 'invalid') result.problems.push(`${entry.id}: the signature does not verify under the manifest's publisher key`);
    else if (verdict === 'valid') result.signatures.valid += 1;
    else if (verdict === 'unchecked') result.signatures.unchecked += 1;
    else throw new Error(`a signature verifier answered ${JSON.stringify(verdict)}`);
    const bytes = abi === null ? null : artifactFor(manifest);
    if (bytes === null) { result.modules.notToHand += 1; continue; }
    result.modules.checked += 1;
    result.problems.push(...importProblems(bytes, manifest, abi).map((p) => `${entry.id}: ${p}`));
  }
  return result;
}
