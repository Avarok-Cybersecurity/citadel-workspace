/**
 * Give every flagged function its return type, one at a time.
 *
 * The general annotator computes these correctly and then loses them: it edits
 * a whole file, and when any single edit in it does not compile the file goes
 * back with all the others. Ninety-seven return types sat behind that, almost
 * all of them test helpers -- `function harness()`, `function renderAt(path)`.
 *
 * Here each edit is applied alone and the compiler is asked. Slower per edit
 * and strictly better per outcome, which is the same lesson three of these
 * codemods have now had to learn separately.
 *
 * Usage: node scripts/annotate-return-types.mjs [maxEdits]
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = Number(process.argv[2] ?? 25);

function typechecks() {
  try {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], { cwd: APP, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

// Only where the gate actually complains.
//
// The first version planned an edit for EVERY function without a return type --
// 4,964 of them -- and annotated twelve that the gate had never asked about,
// because `allowTypedFunctionExpressions` already exempts a contextually typed
// callback. Twelve edits, no change in the count: a tool measuring something
// other than the thing it is trying to move.
const RETURN_RULES = {
  '@typescript-eslint/explicit-function-return-type': ['error', {
    allowExpressions: false, allowTypedFunctionExpressions: true, allowHigherOrderFunctions: true,
  }],
  '@typescript-eslint/explicit-module-boundary-types': 'error',
};
const eslint = new ESLint({
  cwd: APP,
  overrideConfigFile: resolve(APP, 'eslint.config.js'),
  overrideConfig: { rules: RETURN_RULES },
});
/** file -> the lines the gate flags */
const flagged = new Map();
for (const result of await eslint.lintFiles(['src/**/*.ts', 'src/**/*.tsx'])) {
  const lines = result.messages.filter((m) => m.ruleId in RETURN_RULES).map((m) => m.line);
  if (lines.length > 0) flagged.set(result.filePath, new Set(lines));
}

const configPath = ts.findConfigFile(APP, ts.sys.fileExists, 'tsconfig.app.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, APP);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

/** [{ file, position, text }] — every candidate, computed before any edit. */
const plan = [];
for (const source of program.getSourceFiles()) {
  if (source.isDeclarationFile) continue;
  if (!source.fileName.startsWith(resolve(APP, 'src'))) continue;
  const wanted = flagged.get(source.fileName);
  if (!wanted) continue;

  const lineOf = (pos) => ts.getLineAndCharacterOfPosition(source, pos).line + 1;
  /** The gate reports where the type would GO, which for a multi-line
   *  parameter list is several lines below the node's start. */
  const covers = (node) => {
    const from = lineOf(node.getStart(source));
    const to = lineOf(node.body ? node.body.getStart(source) : node.getEnd());
    for (let line = from; line <= to; line += 1) if (wanted.has(line)) return true;
    return false;
  };

  const visit = (node) => {
    const isFunction =
      ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) || ts.isArrowFunction(node);
    if (isFunction && !node.type && node.body && covers(node)) {
      const signature = checker.getSignatureFromDeclaration(node);
      if (signature) {
        const printed = checker
          .typeToString(checker.getReturnTypeOfSignature(signature), node, ts.TypeFormatFlags.NoTruncation)
          // The compiler names JSX through the runtime's path; the namespace is
          // global here and needs no import.
          .replace(/import\("[^"]*jsx-runtime"\)\./g, '');
        // Never `any` -- writing it turns a quiet inference into a declaration
        // this codebase bans. Never a path only the compiler can name.
        const usable =
          printed.length < 200 && !/\bany\b|\berror\b|import\(/.test(printed);
        const insertAt = ts.isArrowFunction(node)
          ? node.equalsGreaterThanToken.getFullStart()
          : node.body.getFullStart();
        const before = source.getFullText().slice(0, insertAt).trimEnd();
        // A parenthesis-less arrow has nowhere to put one.
        const placeable = !ts.isArrowFunction(node) || before.endsWith(')');
        if (usable && placeable) {
          plan.push({ file: source.fileName, position: insertAt, text: `: ${printed}` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

// Back to front within a file, so earlier offsets stay valid between runs.
plan.sort((a, b) => (a.file === b.file ? b.position - a.position : a.file.localeCompare(b.file)));

let written = 0;
for (const edit of plan) {
  if (written >= LIMIT) break;
  const before = readFileSync(edit.file, 'utf-8');
  // Only if the text at that offset is still what the plan expects.
  if (before.slice(edit.position, edit.position + 1) !== '' && before.includes(edit.text) === false) {
    writeFileSync(edit.file, before.slice(0, edit.position) + edit.text + before.slice(edit.position));
    if (typechecks()) written += 1;
    else writeFileSync(edit.file, before);
  }
}

console.log(`  Annotated ${written} return type(s) of ${plan.length} candidate(s).`);
