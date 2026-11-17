/**
 * Write down the types the explicit-types gate is asking for, and only those.
 *
 * `annotate-types.mjs` walks the AST and annotates everything it can. On its
 * first run against `src/lib/utils` that was 52 edits for **one** finding: the
 * gate exempts a contextually-typed function expression, and the annotator did
 * not know that, so fifty-one edits were churn in files nobody had complained
 * about.
 *
 * This one is driven by the findings themselves. ESLint says where, the
 * compiler says what, and every edit therefore removes exactly one finding. It
 * also means the two can never disagree about what counts.
 *
 * The refusals from the original still apply and are the substance:
 *
 *  - a literal type is widened (`const RETRIES = 2` is `number`, not `2`),
 *    because writing the literal narrows the constant and every caller passing
 *    a different number stops compiling;
 *  - `boolean` on a variable is refused, because since TS 4.4 a `const` holding
 *    a condition narrows what it tested, and an annotation discards that;
 *  - anything needing an import it cannot see is refused, because a codemod
 *    that adds imports breaks builds;
 *  - a parenthesis-less arrow (`value => ...`) is skipped, because there is
 *    nowhere to put a return type without rewriting the parameter list.
 *
 * Usage: node scripts/annotate-from-findings.mjs [pathPrefix] [--dry] [--limit N]
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const limitAt = args.indexOf('--limit');
const LIMIT = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
const prefix = args.find((a) => !a.startsWith('--') && a !== String(LIMIT)) ?? 'src';
/**
 * Write the two kinds this tool refuses by default, and let `tsc` judge.
 *
 * Both are refusals about CONSEQUENCE rather than correctness -- the annotation
 * is right and can still break the build:
 *
 *   --allow-boolean  since TS 4.4 a `const` holding a condition narrows what it
 *                    tested, and any annotation discards that.
 *   --allow-literal  writing `2` narrows a numeric constant so callers passing
 *                    another number stop compiling; writing `number` widens a
 *                    string constant so callers expecting the union stop.
 *
 * Neither can be decided from the declaration alone: the answer depends on how
 * the value is USED. So they are written, compiled, and reverted where they do
 * not hold, by scripts/annotate-and-keep-what-compiles.mjs.
 */
const WHY = args.includes('--why');
/** reason -> count, for deciding what to build next rather than guessing. */
const refusals = new Map();
const refuse = (reason, printed) => {
  if (WHY) {
    const key = reason === 'name' ? `name: ${printed}` : reason;
    refusals.set(key, (refusals.get(key) ?? 0) + 1);
  }
  return null;
};
const ALLOW_BOOLEAN = args.includes('--allow-boolean');
const ALLOW_LITERAL = args.includes('--allow-literal');
/**
 * Widen a string literal to `string`.
 *
 * Refused by default because `const CODEC = 'av01.0.05M.08'` is usually a
 * member of a union its call sites expect, and widening it broke thirty of them
 * on the first full run. But most string constants are not that -- a storage
 * key, a path, a prefix -- and `: string` is exactly what a person would write.
 *
 * Which is which cannot be read off the declaration, so this is written under
 * the compile judge: annotate, compile, keep what holds.
 */
const WIDEN_STRINGS = args.includes('--widen-strings');
/**
 * Write `unknown` where the compiler inferred `any`.
 *
 * This project's own rule is "avoid `any` — use `unknown` with type guards", so
 * an inferred `any` is a gap rather than a type, and `unknown` is both the
 * honest annotation and a stricter one. Stricter is the point and also the
 * risk: every use of the value now has to prove what it is, which is exactly
 * what a type guard is for and exactly what will not compile where nobody
 * checked. Written under the compile judge, kept where it holds.
 */
const ANY_AS_UNKNOWN = args.includes('--any-as-unknown');

/**
 * `any` becomes `unknown`, wherever it appears in the type.
 *
 * The first version only swapped a bare `any`, so `any[]`, `Promise<any>` and
 * `Record<string, any>` were all refused -- a hundred of them, which is the
 * largest single class left. This codebase's rule is "avoid `any`, use
 * `unknown` with type guards", and `unknown` inside a generic is the same
 * honest statement as `unknown` alone: stricter, and it will not compile
 * anywhere the value is used without a check. That is the point, and the
 * compile judge is what decides where it holds.
 */
const withoutAny = (printed) =>
  ANY_AS_UNKNOWN ? printed.replace(/\bany\b/g, 'unknown') : printed;
/**
 * At most one annotation per file per run.
 *
 * The compile judge reverts a whole FILE when any edit in it fails, so five
 * good annotations were being thrown away with one bad one -- and the next run
 * proposed the same six again, so the count stopped moving entirely while the
 * work kept repeating.
 *
 * One at a time costs a pass per annotation and makes each pass monotonic:
 * whatever survives is kept, whatever fails costs exactly itself.
 */
const ONE_PER_FILE = args.includes('--one-per-file');

/**
 * Sites the compiler has already rejected, as `path:line`.
 *
 * Without a memory the tool proposes the same failing annotation every pass:
 * the site that cannot take a type is retried forever and the ones behind it in
 * the same file are never reached. The count sat at 660 for three passes for
 * exactly that reason.
 *
 * "Rejected" is not "wrong". It is "the compiler would not accept THIS type
 * here", which is a fact about the surrounding code -- a narrowing an
 * annotation would discard, a generic whose arguments matter. Those need the
 * code changed rather than a type guessed, and they are what will be left.
 */
const REJECTED_PATH = resolve(APP, 'scripts', 'annotate-rejected.json');
/** Finding lines no visitor reached at all -- the tool's blind spots. */
const unreached = [];
const rejected = new Set(
  existsSync(REJECTED_PATH) ? JSON.parse(readFileSync(REJECTED_PATH, 'utf-8')) : [],
);
const PROPOSED_PATH = resolve(APP, 'scripts', 'annotate-proposed.json');
const proposed = [];

/** Type-position words that are never imported. */
/**
 * Names the index lists but a package will not actually let you import.
 *
 * `ClassProp` is declared inside class-variance-authority's types and not
 * exported from its entry point: importing it is "declares 'ClassProp' locally,
 * but it is not exported", which took four files down at once. The index is
 * built from `getExportsOfModule` and still lists it, so the package's own
 * entry point is what disagrees -- and the only honest answer from here is to
 * refuse the type outright.
 */
const NOT_IMPORTABLE = new Set(['ClassProp']);

const TYPE_WORDS = new Set([
      'null', 'undefined', 'void', 'never', 'unknown', 'this', 'keyof', 'typeof',
      'infer', 'extends', 'in', 'is', 'asserts', 'new', 'abstract',
      'Partial', 'Required', 'Pick', 'Omit', 'Exclude', 'Extract', 'NonNullable',
      'ReturnType', 'Parameters', 'Awaited', 'Readonly', 'ReadonlyArray', 'Iterable',
      'Generator', 'AsyncGenerator', 'IterableIterator', 'WeakMap', 'WeakSet',
      'Function', 'Object', 'JSON', 'Math', 'Intl', 'Element', 'Node', 'Event',
      'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLDivElement',
      'HTMLTextAreaElement', 'HTMLCanvasElement', 'HTMLVideoElement', 'HTMLAudioElement',
      'MediaStream', 'MediaStreamTrack', 'AudioContext', 'AudioData', 'VideoFrame',
      'Response', 'Request', 'Headers', 'AbortSignal', 'Worker', 'MessagePort',
      'BroadcastChannel', 'IDBDatabase', 'CustomEvent', 'PointerEvent', 'KeyboardEvent',
      'MouseEvent', 'DOMRect', 'JSX', 'React', 'NodeJS', 'Uint16Array', 'Int32Array',
  'Float32Array', 'DataView', 'SharedArrayBuffer', 'MediaRecorder',
  // Globals the checker prints unqualified and no file needs to import.
  'Timeout', 'Timer', 'Immediate', 'ArrayBufferLike', 'ArrayBufferView',
  'URLSearchParams', 'URLSearchParams', 'Storage', 'Location', 'History',
  'Navigator', 'Window', 'Document', 'DocumentFragment', 'ShadowRoot',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'PerformanceEntry',
  'ReadableStream', 'WritableStream', 'TransformStream', 'TextEncoder', 'TextDecoder',
  'Int8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array', 'Crypto', 'SubtleCrypto', 'CryptoKey',
  'FileSystemDirectoryHandle', 'FileSystemFileHandle', 'FileSystemHandle',
  'FileSystemWritableFileStream', 'FileReader', 'FileList', 'Clipboard',
  'ClipboardItem', 'Notification', 'ServiceWorker', 'ServiceWorkerRegistration',
  'PushSubscription', 'PermissionStatus', 'MediaDevices', 'MediaDeviceInfo',
  'RegExpMatchArray', 'RegExpExecArray', 'PropertyKey', 'ThisType', 'InstanceType',
  'ConstructorParameters', 'OmitThisParameter', 'Capitalize', 'Uncapitalize',
  'Lowercase', 'Uppercase', 'NoInfer', 'IArguments', 'CallableFunction',
]);

const RULES = {
  '@typescript-eslint/typedef': ['error', {
    variableDeclaration: true, memberVariableDeclaration: true,
    propertyDeclaration: true, parameter: true, arrowParameter: false,
    variableDeclarationIgnoreFunction: true,
  }],
  '@typescript-eslint/explicit-function-return-type': ['error', {
    allowExpressions: false, allowTypedFunctionExpressions: true, allowHigherOrderFunctions: true,
  }],
  '@typescript-eslint/explicit-module-boundary-types': 'error',
};

const eslint = new ESLint({
  cwd: APP,
  overrideConfigFile: resolve(APP, 'eslint.config.js'),
  overrideConfig: { rules: RULES },
  // A directory with no .tsx in it is not an error; it is a directory.
  errorOnUnmatchedPattern: false,
});

// Explicit globs, exactly as the gate uses. Handing ESLint a bare directory
// applies its own default extensions and quietly linted a fraction of the
// files: `src/lib/revfs` reported zero findings while the gate counted 279 in
// it. A tool that measures less than the gate it serves will report itself
// finished.
const results = await eslint.lintFiles([`${prefix}/**/*.ts`, `${prefix}/**/*.tsx`, `${prefix}/*.ts`, `${prefix}/*.tsx`]);

/** file -> [{ line, column }] */
const wanted = new Map();
for (const result of results) {
  const findings = result.messages.filter((m) => m.ruleId in RULES);
  if (findings.length > 0) wanted.set(result.filePath, findings);
}

const configPath = ts.findConfigFile(APP, ts.sys.fileExists, 'tsconfig.app.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, APP);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

/**
 * Every exported type name in the program, and the file that declares it.
 *
 * `getSymbolsInScope` only sees what a file can already reach, so a name it
 * cannot reach -- which is exactly the case that needs an import -- resolved to
 * nothing. `RevfsNode`, `ForwardRefExoticComponent` and `Mock` alone were 300
 * refusals for a name the program declares in one obvious place.
 *
 * A name declared in more than one file is left out: guessing which one is
 * meant is how a codemod imports the wrong type.
 */
const declaredIn = new Map();
const ambiguous = new Set();
/** file -> the specifier it would be imported by, computed once. */
const specifierOfFile = new Map();
for (const file of program.getSourceFiles()) {
  const symbol = checker.getSymbolAtLocation(file);
  for (const exported of symbol ? checker.getExportsOfModule(symbol) : []) {
    const name = exported.getName();
    const flags = exported.getFlags();
    const isType = flags & (ts.SymbolFlags.Type | ts.SymbolFlags.Interface |
      ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class | ts.SymbolFlags.Enum);
    if (!isType) continue;
    // Only where it is DECLARED, never where it is re-exported. `src/types/
    // index.ts` is a barrel, so every type in it looked like a second
    // declaration and every one of them came out ambiguous -- StoredSession,
    // ActiveSession, Peer and the rest, all for a file that declares nothing.
    const declaredHere = (exported.declarations ?? []).some(
      (d) => d.getSourceFile().fileName === file.fileName,
    );
    if (!declaredHere) continue;
    // Every candidate is kept. Which one is meant is decided later, on the
    // SPECIFIER each would produce: three files in one package are not an
    // ambiguity, they are one import.
    if (!declaredIn.has(name)) declaredIn.set(name, new Set());
    declaredIn.get(name).add(file.fileName);
  }
}

let annotated = 0;
let touched = 0;

for (const source of program.getSourceFiles()) {
  if (source.isDeclarationFile) continue;
  const findings = wanted.get(source.fileName);
  if (!findings) continue;
  if (annotated >= LIMIT) break;

  /**
   * The LINES ESLint pointed at.
   *
   * Not exact offsets: `typedef` reports the whole declaration and
   * `explicit-function-return-type` the function, so column-exact matching
   * found 686 of 5,528 findings. A line is precise enough to pick the right
   * node and forgiving enough to find it, and `tsc` is what says whether the
   * result is right.
   */
  const relPath = relative(APP, source.fileName);
  const lines = new Set(
    findings.map((f) => f.line).filter((line) => !rejected.has(`${relPath}:${line}`)),
  );
  /** Finding lines a visitor actually reached, to find the ones none does. */
  const visited = new Set();
  const lineOf = (pos) => ts.getLineAndCharacterOfPosition(source, pos).line + 1;
  const onWantedLine = (node) => {
    const line = lineOf(node.getStart(source));
    if (!lines.has(line)) return false;
    visited.add(line);
    return true;
  };
  /**
   * A finding anywhere in this function's SIGNATURE, not only on its first line.
   *
   * ESLint reports `explicit-function-return-type` at the point where the type
   * would go, which for a multi-line parameter list is the closing paren --
   *
   *   const Modal = ({
   *     open,
   *     onClose,
   *   }: ModalProps) => {        <-- reported here
   *
   * -- while the node starts three lines earlier. Matching on the start line
   * alone found none of them: 95 arrows and 87 function declarations, proposed
   * zero times.
   */
  const signatureCovers = (node) => {
    const from = lineOf(node.getStart(source));
    const to = lineOf(node.body ? node.body.getStart(source) : node.getEnd());
    for (let line = from; line <= to; line += 1) {
      if (lines.has(line)) { visited.add(line); return true; }
    }
    return false;
  };

  const edits = [];
  /** name -> module specifier, for types this file cannot yet see. */
  const imports = new Map();

  /**
   * Can this type be written here, importing what it needs?
   *
   * A codemod that adds imports can break a build, so every name is resolved
   * through the checker to a real declaration and turned into a specifier this
   * project already uses -- `@/...` for anything under src, the package name
   * for anything in node_modules. A name that resolves to neither is refused,
   * which is the same answer the first version gave to every name it did not
   * recognise, just arrived at with evidence.
   */
  /**
   * Rewrite `import("/abs/path").Name` into `Name`, planning the import.
   *
   * That form is the compiler saying "this type has a name, but not one this
   * file can see". It was refused outright, and it is 1,428 of the remaining
   * findings -- half of everything left. The path is right there; naming it is
   * the same work `specifierFor` already does for a bare name.
   *
   * `typeof import(...)` has no name to lift, and is still refused.
   */
  const liftImports = (printed) => {
    if (/typeof import\(/.test(printed)) return null;
    let rewritten = printed;
    for (const match of printed.matchAll(/import\("([^"]+)"\)\.([A-Za-z_$][\w$]*)/g)) {
      const [whole, path, name] = match;
      // `JSX` is a global namespace here; importing it is redundant, and the
      // two files it landed in went over the 250-line ceiling for a line that
      // changed nothing.
      if (TYPE_WORDS.has(name)) { rewritten = rewritten.split(whole).join(name); continue; }
      const specifier = specifierForPath(path);
      if (!specifier) return null;
      if (imports.has(name) && imports.get(name) !== specifier) return null;
      imports.set(name, specifier);
      rewritten = rewritten.split(whole).join(name);
    }
    return rewritten;
  };

  const specifierForPath = (path) => {
    if (path.includes('/node_modules/')) {
      const after = path.split('/node_modules/').pop() ?? '';
      const parts = after.split('/');
      let pkg = after.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
      // `@types/react` is a declaration package: importing it is an error --
      // "Cannot import type declaration files. Consider importing 'react'" --
      // and it produced 214 of them in one run. The types live under the name
      // of the package they describe.
      if (pkg.startsWith('@types/')) {
        const described = pkg.slice('@types/'.length);
        pkg = described.includes('__') ? `@${described.replace('__', '/')}` : described;
      }
      return pkg && !pkg.startsWith('typescript') ? pkg : null;
    }
    const src = resolve(APP, 'src');
    if (!path.startsWith(src)) return null;
    const rel = relative(src, path).replace(/\.tsx?$/, '');
    return `@/${rel}`;
  };

  const canWrite = (printed, node) => {
    const missing = unresolvedNames(printed, source);
    if (missing === null) return false;
    for (const name of missing) {
      const specifier = specifierFor(name, node);
      if (!specifier) { refuse('name', `${name}   in   ${printed.slice(0, 70)}`); return false; }
      if (imports.has(name) && imports.get(name) !== specifier) return false;
      imports.set(name, specifier);
    }
    return true;
  };

  const specifierFor = (name) => {
    // The index only, never `getSymbolsInScope`.
    //
    // Scope answers with any symbol visible in the module graph, EXPORTED or
    // not: `ClassProp` is declared inside class-variance-authority's types and
    // not exported, and importing it is an error -- "declares 'ClassProp'
    // locally, but it is not exported" -- in four files at once. The index is
    // built from `getExportsOfModule`, so a name in it is one that can actually
    // be imported. Scope was also redundant: a name still in scope is one
    // `unresolvedNames` has already accepted.
    {
      const candidates = [...(declaredIn.get(name) ?? [])];
      const src = resolve(APP, 'src');
      // Ours first: `StoredSession` exists here and in the generated client
      // package, and the app's own is what every call site means.
      const ours = candidates.filter((c) => c.startsWith(src));
      const pool = ours.length > 0 ? ours : candidates;
      // One import is not an ambiguity even from several files.
      const specifiers = new Set(pool.map((c) => specifierForPath(c)).filter(Boolean));
      if (specifiers.size === 1) return [...specifiers][0];
      // Several packages declare it -- `Mock` is in vitest and in @vitest/spy.
      // The one this file already imports from is the one it means.
      const text = source.getFullText();
      const already = [...specifiers].filter((spec) => text.includes(`from '${spec}'`));
      return already.length === 1 ? already[0] : null;
    }
    // Declared right here. The in-file name test missed it -- a local `const fn
    // = ...` is not matched by a regex looking for `const fn` with a type
    // keyword -- and importing a module from itself is a compile error, which
    // is how this was found.
    if (file === source.fileName) return null;
    return null;
  };

  const unusedSpecifierTail = (file) => {
    if (file.includes('/node_modules/')) {
      const after = file.split('/node_modules/').pop() ?? '';
      const parts = after.split('/');
      const pkg = after.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
      return pkg && !pkg.startsWith('typescript') ? pkg : null;
    }
    const src = resolve(APP, 'src');
    if (!file.startsWith(src)) return null;
    return `@/${relative(src, file).replace(/\.tsx?$/, '')}`;
  };

  const visit = (node) => {
    if (annotated + edits.length >= LIMIT) return;

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      !node.type && node.body && onWantedLine(node)
    ) {
      const signature = checker.getSignatureFromDeclaration(node);
      if (signature) {
        const returned = checker.getReturnTypeOfSignature(signature);
        const shownReturn = checker.typeToString(returned);
        // A bigint literal return type -- `42n` -- narrows the signature and
        // its `n` reads as a type name. Widened, like a number.
        const printed = /^-?\d[\d_]*n$/.test(shownReturn)
          ? checker.typeToString(checker.getBaseTypeOfLiteralType(returned), node)
          : checker.typeToString(
              returned, node,
              ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType,
            );
        const lifted = liftImports(printed === 'any' && ANY_AS_UNKNOWN ? 'unknown' : printed);
        if (lifted !== null && (canWrite(lifted, node) || lifted === 'JSX.Element')) {
          const insertAt = ts.isArrowFunction(node)
            ? node.equalsGreaterThanToken.getFullStart()
            : node.body.getFullStart();
          if (!ts.isArrowFunction(node) || source.getFullText().slice(0, insertAt).trimEnd().endsWith(')')) {
            edits.push({ position: insertAt, text: `: ${lifted}` });
          }
        }
      }
    }

    // A parameter with a default and no type: `function f(open = false)`.
    //
    // The default says what it is, and the compiler agrees -- it infers the
    // parameter's type from exactly that. Twenty-five findings read "Expected a
    // type annotation" for this shape and nothing had ever visited them.
    if (
      ts.isParameter(node) &&
      !node.type &&
      ts.isIdentifier(node.name) &&
      onWantedLine(node)
    ) {
      // With OR without a default.
      //
      // A default says what the parameter is. Without one the type comes from
      // context -- `run: (db, _tx) => {}` inside an object whose shape is
      // declared elsewhere -- and the checker knows it for the same reason the
      // code compiles. Requiring a default missed every one of those:
      // `upgrade(db, oldVersion, newVersion, tx)` and its neighbours were
      // reached by no visitor at all.
      const at = checker.getTypeAtLocation(node);
      const widened = node.initializer ? checker.getBaseTypeOfLiteralType(at) : at;
      const printed = checker.typeToString(
        widened, node,
        ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType,
      );
      // An implicit-any parameter prints as `any`, and writing that down turns
      // an inference the compiler made quietly into a declaration the codebase
      // bans -- `no-explicit-any` caught one and failed the lint gate. It is
      // also the opposite of the point: the parameter has no type, and saying
      // `any` is agreeing rather than fixing.
      const lifted = printed === 'any' ? null : liftImports(printed);
      if (lifted !== null && canWrite(lifted, node)) {
        edits.push({ position: node.name.getEnd(), text: `: ${lifted}` });
      }
    }

    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      !node.type && ts.isIdentifier(node.name) && onWantedLine(node)
    ) {
      // Widening is decided per KIND of literal, because the two directions
      // fail differently:
      //
      //  - a string literal widened to `string` breaks every call site
      //    expecting the union it belongs to (30-odd errors on the first run);
      //  - a number or bigint literal written down narrows the constant so a
      //    caller passing another value stops compiling, and `prefer-as-const`
      //    rejects the shape as well.
      //
      // So numbers and bigints widen and strings do not, unless asked.
      const inferred = checker.getTypeAtLocation(node);
      const shown = checker.typeToString(inferred);
      const isString = /^["'`]/.test(shown);
      const isNumericLiteral = /^-?\d[\d_.eE+]*n?$/.test(shown);
      const type =
        isNumericLiteral || (ALLOW_LITERAL && WIDEN_STRINGS && isString)
          ? checker.getBaseTypeOfLiteralType(inferred)
          : inferred;
      const printed = checker.typeToString(
        type, node,
        ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType,
      );
      const lifted = liftImports(withoutAny(printed));
      if (lifted !== null && canWrite(lifted, node)) {
        edits.push({ position: node.name.getEnd(), text: `: ${lifted}` });
      } else if (
        node.initializer &&
        ts.isNewExpression(node.initializer) &&
        !node.initializer.typeArguments &&
        /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(node.initializer.expression.getText(source))
      ) {
        // `const doc = new Y.Doc()` is a `Y.Doc`. The constructor names the
        // type, and it is already in scope because it is being called.
        edits.push({
          position: node.name.getEnd(),
          text: `: ${node.initializer.expression.getText(source)}`,
        });
      } else if (
        node.initializer &&
        ts.isAwaitExpression(node.initializer) &&
        ts.isCallExpression(node.initializer.expression) &&
        node.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.initializer.expression.arguments.length === 1 &&
        ts.isStringLiteral(node.initializer.expression.arguments[0])
      ) {
        // `const store = await import('@/lib/x')` is `typeof import('@/lib/x')`
        // -- which is real TypeScript and needs no import of its own.
        const module = node.initializer.expression.arguments[0].text;
        edits.push({ position: node.name.getEnd(), text: `: typeof import('${module}')` });
      } else if (
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        node.initializer.typeArguments?.length === 2 &&
        /(^|\.)forwardRef$/.test(node.initializer.expression.getText(source))
      ) {
        // `React.forwardRef<Element, Props>(...)` has one possible result type,
        // and its two type arguments are written right there in the source:
        //
        //   React.ForwardRefExoticComponent<Props & React.RefAttributes<Element>>
        //
        // That is what the compiler prints too, except it prints it EXPANDED --
        // hundreds of characters naming prop types the package does not export,
        // like SlotProps and LucideProps. Rebuilding it from the arguments
        // needs no import beyond React, which every one of these files already
        // has. The shadcn primitives are built almost entirely of this shape:
        // sidebar, dialog, sheet, select, dropdown-menu, context-menu.
        const [element, props] = node.initializer.typeArguments.map((t) => t.getText(source));
        edits.push({
          position: node.name.getEnd(),
          text: `: React.ForwardRefExoticComponent<${props} & React.RefAttributes<${element}>>`,
        });
      } else if (
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        node.initializer.typeArguments === undefined &&
        (ts.isIdentifier(node.initializer.expression) ||
          ts.isPropertyAccessExpression(node.initializer.expression))
      ) {
        // `ReturnType<typeof f>` for `const x = f()`.
        //
        // Most of what is left is this shape: `const onOpen = vi.fn()`,
        // `const location = useLocation()`, `const confirm = useConfirm()`.
        // The inferred type is a `Mock<...>` or a router type the file would
        // have to import, and half the time the compiler prints it as `any`.
        // `ReturnType<typeof vi.fn>` needs no import at all -- the callee is
        // right there being called -- and is exactly what a person writes.
        //
        // Refused where the call passes type arguments, because then the
        // caller has said something `ReturnType` would throw away. Generic
        // inference from the ARGUMENTS is the case this can still get wrong,
        // which is what the compile judge is for.
        const callee = node.initializer.expression.getText(source);
        // `typeof` takes an entity NAME, not an expression. Two shapes broke
        // the parse outright:
        //
        //   typeof vi.spyOn(console, 'error').mockImplementation   -- a call
        //   typeof state.treeSchema.rules?.find                    -- optional
        //
        // Only a plain dotted path qualifies.
        if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(callee)) {
          edits.push({ position: node.name.getEnd(), text: `: ReturnType<typeof ${callee}>` });
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  if (WHY) {
    for (const line of lines) {
      if (!visited.has(line)) unreached.push(`${relPath}:${line}`);
    }
  }

  if (edits.length === 0) continue;
  const applied = ONE_PER_FILE ? edits.slice(0, 1) : edits;
  touched += 1;
  annotated += applied.length;
  if (DRY) continue;

  let text = readFileSync(source.fileName, 'utf-8');
  for (const edit of applied) {
    proposed.push(`${relPath}:${ts.getLineAndCharacterOfPosition(source, edit.position).line + 1}`);
  }
  for (const edit of applied.sort((a, b) => b.position - a.position)) {
    text = text.slice(0, edit.position) + edit.text + text.slice(edit.position);
  }
  if (imports.size > 0) {
    // After the last existing import, so the new lines land with the others and
    // never above a directive like 'use client'.
    const lastImport = [...text.matchAll(/^import .*?;$/gm)].pop();
    const at = lastImport ? lastImport.index + lastImport[0].length : 0;
    const lines = [...imports.entries()]
      .map(([name, specifier]) => `\nimport type { ${name} } from '${specifier}';`)
      .join('');
    text = text.slice(0, at) + lines + text.slice(at);
  }
  writeFileSync(source.fileName, text);
}

/**
 * The names in a printed type that this file cannot already see.
 *
 * Returns `null` when the type is one to refuse outright, and an array
 * (possibly empty) of names needing an import otherwise.
 */
function unresolvedNames(printed, source) {
  // 200, not 60. A long type is ugly and true; the reason to refuse one is that
  // it cannot be written without an import, which the name test below decides.
  // 400. The cap is a readability judgement, not a safety one, and the compile
  // judge is what decides safety. Two hundred was refusing types that are long
  // because the thing genuinely has that shape.
  // 900. Length is a readability judgement and the compiler is what decides
  // safety; a type that is long because the thing genuinely has that shape is
  // still the truth, and a reader is better served by it than by nothing.
  if (printed.length > 900) return refuse('too long', printed);
  // `import(...)` in a printed type is the compiler saying it cannot name this
  // without a path, and `any` is not something to write down in a codebase that
  // bans it. Object and function type literals are allowed: they are printable
  // in full, and `tsc` says whether the result is right.
  // `import(...)` is the compiler saying it cannot name this without a path;
  // writing that is not something a person would do. `any` is banned outright
  // in this codebase, so an inferred `any` is a finding for a human, not a
  // string to write down.
  if (/\bimport\(|typeof import/.test(printed)) return refuse('import(...)', printed);
  if (/\bany\b/.test(printed)) return refuse('any', printed);
  if (/\berror\b/.test(printed)) return refuse('error', printed);
  if (!ALLOW_LITERAL && (/^["'`]/.test(printed) || /^-?\d/.test(printed) || /^(true|false)$/.test(printed))) return refuse('literal', printed);
  if (!ALLOW_BOOLEAN && printed === 'boolean') return refuse('boolean', printed);
  // Property names are not type names. `{ cid: bigint; op_id: string }` was
  // being asked to resolve `cid` and `op_id` as if they were types, and every
  // object literal with a field this file happened not to declare was refused
  // for it -- `cid` alone accounted for thirty.
  const withoutProperties = printed
    // Template literal types: `${string}-${number}` is not three type names.
    .replace(/`[^`]*`/g, 'string')
    .replace(/"[^"]*"/g, 'string')
    .replace(/'[^']*'/g, 'string')
    // `readonly foo:` and `foo?:` and `[key: string]:` are property positions.
    .replace(/\breadonly\s+/g, '')
    .replace(/\[\s*[A-Za-z_$][\w$]*\s*:/g, '[:')
    .replace(/([A-Za-z_$][\w$]*)\s*\??\s*:/g, ':');
  const names = withoutProperties.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  // A single upper-case letter is a type PARAMETER -- `T`, `K`, `V`. It has no
  // declaration to import and never will; refusing the whole type is right.
  if (names.some((name) => /^[A-Z]$/.test(name))) return refuse('type parameter', printed);
  const blocked = names.find((name) => NOT_IMPORTABLE.has(name));
  if (blocked) return refuse('not importable', blocked);
  const BUILTIN = new Set([
    'string', 'number', 'boolean', 'void', 'bigint', 'symbol', 'object', 'true', 'false',
    'Array', 'Promise', 'Map', 'Set', 'Record', 'Date', 'RegExp', 'Error', 'Uint8Array',
    'ArrayBuffer', 'Blob', 'File', 'FormData', 'URL', 'AbortController', 'readonly',
  ]);
  const text = source.getFullText();
  const KEYWORD = TYPE_WORDS;
  return names.filter(
    (name) =>
      !BUILTIN.has(name) &&
      !KEYWORD.has(name) &&
      !new RegExp(`\\b(import[^;]*\\b${name}\\b|(interface|type|class|enum|function|const|let)\\s+${name}\\b)`).test(text),
  );
}


if (!DRY) writeFileSync(PROPOSED_PATH, `${JSON.stringify(proposed)}\n`);
console.log(`${DRY ? 'Would annotate' : 'Annotated'} ${annotated} finding(s) across ${touched} file(s) under ${prefix}.`);
if (WHY && unreached.length > 0) {
  console.log(`\n  ${unreached.length} finding(s) no visitor reached:`);
  const byFile = new Map();
  for (const site of unreached) {
    const file = site.rsplit ? site : site.slice(0, site.lastIndexOf(':'));
    byFile.set(file, (byFile.get(file) ?? 0) + 1);
  }
  for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(count).padStart(4)}  ${file}`);
  }
  for (const site of unreached.slice(0, 12)) {
    const [file, line] = [site.slice(0, site.lastIndexOf(':')), Number(site.slice(site.lastIndexOf(':') + 1))];
    const text = readFileSync(resolve(APP, file), 'utf-8').split('\n')[line - 1] ?? '';
    console.log(`      ${site}  ${text.trim().slice(0, 74)}`);
  }
}
if (WHY) {
  const sorted = [...refusals.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, n]) => sum + n, 0);
  console.log(`\n  ${total} refusal(s):`);
  for (const [reason, count] of sorted.slice(0, 18)) console.log(`    ${String(count).padStart(5)}  ${reason}`);
}
