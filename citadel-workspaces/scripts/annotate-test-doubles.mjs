/**
 * Annotate the one shape the general annotator will not touch: a test double.
 *
 * `const io = { setSelectedUser: vi.fn(...), connect: vi.fn(...) }` is 47 of the
 * remaining findings. The compiler's type for it is an anonymous shape whose
 * every member is `Mock<Procedure>` -- a name the annotator refuses because it
 * would have to add an import, and rightly so: a codemod that adds imports
 * breaks builds.
 *
 * There is no need for the import. `ReturnType<typeof vi.fn>` names the same
 * type using a binding the file already has, because the file called `vi.fn` to
 * make it. Values that are not `vi.fn(...)` are handled only when they are a
 * plain literal whose type is obvious from the token; anything else and the
 * whole declaration is skipped, because a half-described shape is worse than an
 * inferred one.
 *
 * Usage: node scripts/annotate-test-doubles.mjs [pathPrefix] [--dry]
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const prefix = args.find((a) => !a.startsWith('--')) ?? 'src';

const RULES = {
  '@typescript-eslint/typedef': ['error', {
    variableDeclaration: true, memberVariableDeclaration: true,
    propertyDeclaration: true, parameter: true, arrowParameter: false,
    variableDeclarationIgnoreFunction: true,
  }],
};

const eslint = new ESLint({
  cwd: APP,
  overrideConfigFile: resolve(APP, 'eslint.config.js'),
  overrideConfig: { rules: RULES },
  errorOnUnmatchedPattern: false,
});

const results = await eslint.lintFiles([
  `${prefix}/**/*.ts`, `${prefix}/**/*.tsx`, `${prefix}/*.ts`, `${prefix}/*.tsx`,
]);

/** The type for one property value, or null when it is not one this understands. */
function typeOfValue(node) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText();
    if (callee === 'vi.fn' || callee.endsWith('.mockResolvedValue') || callee.endsWith('.mockReturnValue')) {
      return 'ReturnType<typeof vi.fn>';
    }
    return null;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return 'boolean';
  if (ts.isStringLiteral(node)) return 'string';
  if (ts.isNumericLiteral(node)) return 'number';
  if (ts.isBigIntLiteral(node)) return 'bigint';
  return null;
}

let annotated = 0;
const touched = new Set();

for (const result of results) {
  const findings = result.messages.filter((m) => m.ruleId in RULES);
  if (findings.length === 0) continue;

  const original = readFileSync(result.filePath, 'utf-8');
  const source = ts.createSourceFile(result.filePath, original, ts.ScriptTarget.Latest, true);
  const edits = [];

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      !node.type &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer) &&
      ts.isIdentifier(node.name)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.name.getStart(source));
      if (findings.some((f) => f.line === line + 1)) {
        const members = [];
        let understood = true;
        for (const property of node.initializer.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
            understood = false;
            break;
          }
          const type = typeOfValue(property.initializer);
          if (!type) { understood = false; break; }
          members.push(`${property.name.text}: ${type}`);
        }
        if (understood && members.length > 0) {
          edits.push({ at: node.name.getEnd(), text: `: { ${members.join('; ')} }` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (edits.length === 0) continue;
  let next = original;
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    next = next.slice(0, edit.at) + edit.text + next.slice(edit.at);
  }
  annotated += edits.length;
  touched.add(relative(APP, result.filePath));
  if (!DRY) writeFileSync(result.filePath, next);
}

console.log(
  `${DRY ? 'Would annotate' : 'Annotated'} ${annotated} test double(s) across ${touched.size} file(s) under ${prefix}.`,
);
