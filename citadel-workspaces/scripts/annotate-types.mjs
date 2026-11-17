/**
 * Write the inferred type onto declarations that do not state one.
 *
 * A tool, not a gate: `check-explicit-types.mjs` says what is missing, and this
 * fills in the cases where the answer is unambiguous. 7,822 findings is not a
 * hand-editing job, and hand-editing is also where a wrong annotation would come
 * from — the compiler already knows the type, so it should be the one to write
 * it.
 *
 * ## What it will and will not annotate
 *
 * It annotates a `const`/`let` whose inferred type prints as a name this file
 * can already refer to: primitives, arrays and unions of them, and named types
 * that are already imported or declared in the same file. It refuses anything
 * that would need a new import, anything anonymous (`{ a: string; b: number }`),
 * anything longer than 60 characters, and anything containing `import(` or
 * `typeof import` — those are the annotations that turn a one-line change into
 * a dependency, and a codemod that adds imports is a codemod that breaks builds.
 *
 * Every run ends with `tsc --noEmit`, and a run that does not typecheck is not
 * a run whose output should be committed.
 *
 * Usage: node scripts/annotate-types.mjs <glob-or-dir> [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!target) {
  console.error('usage: node scripts/annotate-types.mjs <dir-or-file> [--dry]');
  process.exit(1);
}

const configPath = ts.findConfigFile(APP, ts.sys.fileExists, 'tsconfig.app.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, APP);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

const wanted = resolve(APP, target);
let annotated = 0;
let files = 0;

for (const source of program.getSourceFiles()) {
  if (source.isDeclarationFile) continue;
  if (!source.fileName.startsWith(wanted)) continue;

  /** `[{ position, text }]`, applied back-to-front so earlier offsets stay valid. */
  const edits = [];

  const visit = (node) => {
    // Return types, where the signature does not state one.
    //
    // Safer than a variable annotation and worth more: a return type is the
    // contract every caller reads, and it is the one place inference reaches
    // furthest -- change a function's body and its type changes three modules
    // away with nothing to say so. None of the narrowing hazards apply, because
    // a return type does not alias a condition.
    // Arrow functions and function expressions too, not only named ones.
    //
    // They are most of the debt -- every callback passed to a hook, an event
    // handler or an options object -- and `void` is most of THEIR answer, which
    // the first version skipped as though it were nothing to say. It is the
    // whole statement for a callback: this returns nothing, and a body that
    // starts returning something is a change to its contract.
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)) &&
      !node.type &&
      node.body
    ) {
      const signature = checker.getSignatureFromDeclaration(node);
      if (signature) {
        const printed = checker.typeToString(
          checker.getReturnTypeOfSignature(signature),
          node,
          ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType,
        );
        // `JSX.Element` prints unqualified and resolves globally; everything
        // else goes through the same import-free test as a variable.
        if ((isSafe(printed, source) || printed === 'JSX.Element') && printed !== 'any') {
          // After the parameter list, before `=>` or the body.
          //
          // A parenthesis-less arrow -- `value => ...` -- has nowhere to put a
          // return type: inserting before the `=>` lands inside the parameter
          // and produces `value: void =>`, which is a syntax error the first
          // run made in six files. Skipped rather than parenthesised, because a
          // codemod that rewrites parameter lists is a different and larger
          // thing than one that writes down a type.
          const insertAt = ts.isArrowFunction(node)
            ? node.equalsGreaterThanToken.getFullStart()
            : node.body.getFullStart();
          const before = source.getFullText().slice(0, insertAt).trimEnd();
          if (!ts.isArrowFunction(node) || before.endsWith(')')) {
            edits.push({ position: insertAt, text: `: ${printed}` });
          }
        }
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      !node.type &&
      node.initializer &&
      ts.isIdentifier(node.name)
    ) {
      // Widened, not the literal. `const RETRIES = 2` infers the literal type
      // `2`; writing that down narrows the constant to a single value and every
      // caller passing a different number stops compiling. The base type is
      // what the declaration already means -- `number` -- and is what a person
      // would have written. This unlocks the whole class the first version had
      // to refuse outright.
      const inferred = checker.getTypeAtLocation(node);
      const type =
        ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const
          ? checker.getBaseTypeOfLiteralType(inferred)
          : inferred;
      const printed = checker.typeToString(
        type,
        node,
        ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType,
      );
      if (isSafe(printed, source)) {
        edits.push({ position: node.name.getEnd(), text: `: ${printed}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (edits.length === 0) continue;
  files += 1;
  annotated += edits.length;
  if (DRY) continue;

  let text = readFileSync(source.fileName, 'utf-8');
  for (const edit of edits.sort((a, b) => b.position - a.position)) {
    text = text.slice(0, edit.position) + edit.text + text.slice(edit.position);
  }
  writeFileSync(source.fileName, text);
}

/** Whether an inferred type can be written down here without adding an import. */
function isSafe(printed, source) {
  if (printed.length > 60) return false;
  if (/\bimport\(|typeof import|\{|\}|=>|any\b|error\b/.test(printed)) return false;
  if (/^(any|unknown|never|null|undefined)$/.test(printed)) return false;
  // Literal types, of ANY kind. `const DEFAULT_LIST_RETRIES = 2` infers the
  // literal type `2`, and writing that down narrows the constant from `number`
  // to a single value -- every caller that passed a different number then stops
  // compiling. The first run of this tool did exactly that, and `tsc` caught it:
  //   Argument of type 'number' is not assignable to parameter of type '2'
  // A codemod that adds imports breaks builds; so does one that narrows a
  // constant. Both are refused here rather than reviewed afterwards.
  if (/^["'`]/.test(printed)) return false;
  if (/^-?\d/.test(printed)) return false;
  if (/^(true|false)$/.test(printed)) return false;
  // `boolean`, refused outright.
  //
  // Since TypeScript 4.4 a `const` holding a condition narrows the things it
  // tested -- `const isEditing = !!role` lets `if (isEditing)` treat `role` as
  // non-null. That only works while the const has NO annotation. Writing
  // `: boolean` on it discards the aliased condition, and the narrowing goes
  // with it:
  //   'role' is possibly 'null'
  //   Type 'number | undefined' is not assignable to type 'number'
  // Both appeared the moment this tool annotated two such constants. An
  // annotation that is correct and still breaks the build is worth refusing:
  // the type was already known here, and stating it costs a narrowing that was
  // doing real work.
  if (printed === 'boolean') return false;
  const names = printed.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  const BUILTIN = new Set([
    'string', 'number', 'boolean', 'void', 'bigint', 'symbol', 'object', 'true', 'false',
    'Array', 'Promise', 'Map', 'Set', 'Record', 'Date', 'RegExp', 'Error', 'Uint8Array',
    'ArrayBuffer', 'Blob', 'File', 'FormData', 'URL', 'AbortController', 'readonly',
  ]);
  const text = source.getFullText();
  return names.every(
    (name) =>
      BUILTIN.has(name) ||
      // Already referred to by name somewhere in this file: an import, a local
      // declaration, or a type alias. Anything else would need a new import.
      new RegExp(`\\b(import[^;]*\\b${name}\\b|(interface|type|class|enum)\\s+${name}\\b)`).test(text),
  );
}

console.log(`${DRY ? 'Would annotate' : 'Annotated'} ${annotated} declaration(s) across ${files} file(s).`);
