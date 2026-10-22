/**
 * The catalogue and manifest rules the gate applies are the UI's own
 * (citadel-workspaces/src/lib/citadel-apps/manifest/), not a second copy: those modules import
 * only each other, two siblings and types, so each is transpiled on its own with TypeScript into a
 * scratch directory and imported. The manifest rules there are drift-tested against the shared
 * Rust cases (apps/catalogue/fixtures/manifest-cases.json), so the gate, the UI and the kernel
 * read a catalogue entry the same way.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPS_SRC = join(ROOT, 'citadel-workspaces/src/lib/citadel-apps');

/** Every module the catalogue reader reaches, relative to APPS_SRC. A missing one fails loudly. */
export const RULE_MODULES = [
  'manifest/catalogue-format.ts', 'manifest/manifest-rules.ts', 'manifest/manifest-rules-parts.ts',
  'manifest/manifest-shape.ts', 'manifest/json-duplicate-keys.ts', 'manifest/net-rules.ts',
  'app-identity.ts', 'icon.ts',
  // The capability list is the SDK's generated one, read through the host's module.
  'host/capabilities.ts', 'sdk/generated/AbiConstants.ts',
];

const RELATIVE_IMPORT = /(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g;

/** Transpile one module, pointing its relative imports at the transpiled siblings. */
function transpile(source, name) {
  const out = ts.transpileModule(source, {
    fileName: name,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  }).outputText;
  return out.replace(RELATIVE_IMPORT, (_m, open, path, close) => `${open}${path}.mjs${close}`);
}

/** `{ readCatalogue, readManifestBytes }` from the UI's modules; the scratch copy is removed. */
export async function loadCatalogueRules() {
  const dir = mkdtempSync(join(tmpdir(), 'app-catalogue-rules-'));
  try {
    for (const module of RULE_MODULES) {
      const source = readFileSync(join(APPS_SRC, module), 'utf8');
      const target = join(dir, module.replace(/\.ts$/, '.mjs'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, transpile(source, module));
    }
    const catalogue = await import(pathToFileURL(join(dir, 'manifest/catalogue-format.mjs')).href);
    const manifest = await import(pathToFileURL(join(dir, 'manifest/manifest-rules.mjs')).href);
    return { readCatalogue: catalogue.readCatalogue, readManifestBytes: manifest.readManifestBytes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
