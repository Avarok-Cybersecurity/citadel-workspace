/**
 * Give a getter its return type.
 *
 * `get ownCid() { return self.ownCid; }` is a function with a return type and
 * no way to state it, and the general walker never reached one -- thirteen of
 * them sit in a single object literal in the yjs provider.
 *
 * The compiler already knows the answer: it is the type of the expression the
 * getter returns. Asked for it directly and written down, with the compiler
 * given the final word as everywhere else.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const configPath = ts.findConfigFile(APP, ts.sys.fileExists, 'tsconfig.app.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, APP);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

function typechecks() {
  try {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], { cwd: APP, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

const plans = new Map();
for (const source of program.getSourceFiles()) {
  if (source.isDeclarationFile) continue;
  if (!source.fileName.startsWith(resolve(APP, 'src'))) continue;

  const edits = [];
  const visit = (node) => {
    if (ts.isGetAccessorDeclaration(node) && !node.type && node.body) {
      const signature = checker.getSignatureFromDeclaration(node);
      if (signature) {
        const printed = checker.typeToString(
          checker.getReturnTypeOfSignature(signature), node, ts.TypeFormatFlags.NoTruncation,
        );
        // Nothing needing an import, and never `any`: writing that turns a
        // quiet inference into a declaration this codebase bans.
        if (!/import\(|\bany\b|\berror\b/.test(printed) && printed.length < 120) {
          edits.push({ position: node.body.getFullStart(), text: `: ${printed}` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (edits.length > 0) plans.set(source.fileName, edits);
}

let written = 0;
for (const [file, edits] of plans) {
  // One at a time: a file whose fourth getter cannot take its type should not
  // cost the three before it.
  for (const edit of edits.sort((a, b) => b.position - a.position)) {
    const before = readFileSync(file, 'utf-8');
    writeFileSync(file, before.slice(0, edit.position) + edit.text + before.slice(edit.position));
    if (typechecks()) written += 1;
    else writeFileSync(file, before);
  }
}

console.log(`  Annotated ${written} getter(s) across ${plans.size} file(s).`);
