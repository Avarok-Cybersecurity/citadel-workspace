/**
 * A generated type nothing exports is a type nobody can import.
 *
 * `typescript-client/src/types/index.ts` is the package's only entry point for
 * the wire types, and `generate_types.sh` wrote it from a HEREDOC of about a
 * hundred hardcoded `export *` lines. A newly generated type was therefore
 * exported by nothing, silently — and nothing noticed, because `tsc` is
 * perfectly happy with a file nobody imports.
 *
 * Five media types lived that way: `MediaFrameNotification`,
 * `MediaGapNotification`, `MediaSessionOpened`, `MediaSessionFailed`,
 * `MediaSessionClosed`. Generated, committed, and reachable from no entry point
 * in the stack. The UI needed the frame shape, could not import it, and
 * hand-wrote the interface instead — and the hand copy had already drifted,
 * omitting `sequence`. An `as` cast at the use site meant the compiler never
 * said so.
 *
 * Anyone who fixed `index.ts` by hand lost the edit on the next run of the
 * script, which overwrote it unconditionally, while the README advertises that
 * script as safe to re-run.
 *
 * The generator now DERIVES the index from the directory. This is the check
 * that it still does — the fifth hand-maintained list this session to be the
 * hole in something, and the reason the rule here is "derive, then verify the
 * derivation" rather than "keep the list up to date".
 *
 * AND IT CHECKS WHAT CONSUMERS IMPORT, because the first version of that
 * derivation broke the build.
 *
 * The heredoc it replaced contained one line the directory cannot produce: a
 * re-export of nine protocol types (`SecurityLevel` among them) from an
 * external package, which `InternalServiceRequest` references in its field
 * types. Deriving the index from the directory silently dropped it, and
 * `citadel-workspace-client-ts` failed with `TS2614: no exported member
 * 'SecurityLevel'`.
 *
 * A two-way diff of directory against index was satisfied throughout — because
 * both sides of that comparison agreed, and the missing thing was in neither.
 * Verifying a derivation against the source it derives from cannot see what the
 * source never had. So this also asks the CONSUMER: every name
 * `citadel-workspace-client-ts` imports from the package must be exported by
 * it.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = join(
  ROOT, 'citadel-internal-service', 'typescript-client', 'src', 'types',
);

if (!existsSync(TYPES)) {
  console.error(
    `FAIL: ${relative(ROOT, TYPES)} is not present, so this gate examined nothing.\n` +
      'Run `git submodule update --init --recursive` first.',
  );
  process.exit(1);
}

const INDEX = join(TYPES, 'index.ts');
if (!existsSync(INDEX)) {
  console.error('FAIL: the types index does not exist, so nothing is exported at all.');
  process.exit(1);
}

const generated = readdirSync(TYPES)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .map((f) => f.replace(/\.ts$/, ''))
  .sort();

const index = readFileSync(INDEX, 'utf8');
const exported = [...index.matchAll(/from\s+'\.\/([A-Za-z0-9_]+)(?:\.js)?'/g)]
  .map((m) => m[1])
  .sort();

const missing = generated.filter((t) => !exported.includes(t));
const phantom = exported.filter((t) => !generated.includes(t));

// Vacuity floor: this package has a hundred types. Finding almost none means the
// layout moved and this gate is reporting a clean bill over an empty directory.
if (generated.length < 50) {
  console.error(
    `FAIL: found only ${generated.length} generated type(s); the layout moved, so this gate\n` +
      'examined essentially nothing.',
  );
  process.exit(1);
}

if (missing.length > 0 || phantom.length > 0) {
  for (const t of missing) {
    console.error(`::error::${t} is generated but exported by nothing — it cannot be imported`);
  }
  for (const t of phantom) {
    console.error(`::error::index.ts exports ${t}, which no generated file provides`);
  }
  console.error(
    `\nFAIL: ${missing.length} unexported and ${phantom.length} phantom type(s).\n`,
  );
  console.error(
    'Re-run `./generate_types.sh`, which derives the index from this directory.\n' +
      '\nThe last five of these were the media types. The UI needed one of them, could not\n' +
      'import it, hand-wrote the interface, and the hand copy had already lost a field —\n' +
      'with an `as` cast at the use site so the compiler never objected.',
  );
  process.exit(1);
}

// What the consumer actually imports must be exported. This is the half a
// directory-versus-index diff structurally cannot see.
const CLIENT = join(ROOT, 'citadel-workspace-client-ts', 'src');
if (existsSync(CLIENT)) {
  const wanted = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(
        /import\s+type\s*\{([^}]*)\}\s*from\s*'citadel-internal-service-wasm-client'/g,
      )) {
        for (const name of m[1].split(',')) {
          const clean = name.trim().split(/\s+as\s+/)[0].trim();
          if (clean) wanted.add(clean);
        }
      }
    }
  };
  walk(CLIENT);

  // A name is exported if a generated file bears it, or ANY of the package's
  // own modules names it in an `export` clause.
  //
  // The package's public entry is `src/index.ts`, which re-exports the types
  // index AND declares its own surface (`WasmClientConfig`, `WasmModule`, ...).
  // Checking only the types index reported four of those as missing — four
  // invented findings out of five, against names that are exported perfectly
  // well one file up.
  const explicit = new Set();
  const collectExports = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { collectExports(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
        for (const n of m[1].split(',')) {
          const clean = n.trim().split(/\s+as\s+/).pop().trim();
          if (clean) explicit.add(clean);
        }
      }
      for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:type|interface|class|const|function)\s+(\w+)/g)) {
        explicit.add(m[1]);
      }
    }
  };
  collectExports(join(TYPES, '..'));
  const unexported = [...wanted].filter((n) => !generated.includes(n) && !explicit.has(n)).sort();

  if (unexported.length > 0) {
    for (const n of unexported) {
      console.error(
        `::error::citadel-workspace-client-ts imports ${n} from the package, which exports ` +
          'nothing by that name — the build fails with TS2614',
      );
    }
    console.error(
      `\nFAIL: ${unexported.length} name(s) the client imports and the package does not export.\n` +
        '\nThe last one of these was `SecurityLevel`, lost when the index stopped being a\n' +
        'hardcoded list: the heredoc carried a re-export from an external package that a\n' +
        'directory listing cannot produce, and a diff of directory against index agreed with\n' +
        'itself while the build broke.',
    );
    process.exit(1);
  }
}

console.log(
  `check-generated-types-are-all-exported: ${generated.length} generated type(s), ` +
    'every one exported by index.ts, no export without a file, and every name the client ' +
    'imports is exported.',
);
