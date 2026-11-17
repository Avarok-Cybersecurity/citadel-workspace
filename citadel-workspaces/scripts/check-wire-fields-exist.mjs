/**
 * Reading a field the wire message does not have.
 *
 * `getVariant(message, 'X')` hands back a `Record<string, unknown>`, so every
 * property read off it is a cast the compiler cannot check. Read a name the
 * message does not carry and you get `undefined` — silently, forever.
 *
 * `ServerAutoConnectService.handleConnectionSuccess` read `username` and
 * `server_addr` off `ConnectSuccess` and did all of its work inside
 * `if (username)`. Rust declares `ConnectSuccess { cid, request_id }` and the
 * generated binding agrees. The body had never run: a session that reconnected
 * successfully kept its retry timer forever, and ServerAutoConnect retrying a
 * settled connection is a known cause of P2P flakiness here.
 *
 * The same shape left a refused peer-registration request stuck in the outgoing
 * list forever (round 463) — that one keyed on `peer_cid`, which
 * `PeerRegisterFailure` does not have either. CLAUDE.md warns about this class
 * in as many words, using `peer_username` vs `username` as its example, because
 * it has bitten this codebase repeatedly.
 *
 * The generated ts-rs bindings are the authority, so the question is decidable:
 * resolve each `getVariant(message, 'X')` binding to its type and check every
 * property read against that type's fields.
 *
 * WHAT IT SEES, tested rather than assumed. Reads off a variable bound from
 * `getVariant(message, 'X')`, including through a cast: the first version of
 * this check missed `(notification as { peer_username?: string })
 * .peer_username`, a control in that form did NOT fail, and the assertion is
 * precisely what makes such a read unsafe — it silences the compiler without
 * consulting the wire. Casts, parentheses and `!` are now unwrapped first.
 *
 * What it still cannot see: a message whose variant is chosen dynamically, and
 * a field reached after the object has been passed to another function that
 * re-types it. Both would need the type checker rather than the syntax tree.
 *
 * The baseline is empty: the tree has no phantom reads left. Kept as a baseline
 * rather than a bare wall so a future one is reported the same way as any other
 * ratchet.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const ui = resolve(scriptsDir, '..');
const typesDir = resolve(ui, '..', 'citadel-internal-service', 'typescript-client', 'src', 'types');
const BASELINE = resolve(scriptsDir, 'phantom-wire-fields.baseline.json');

if (!existsSync(typesDir)) {
  // Loud, not skipped: without the bindings this check cannot fail, and a
  // check that cannot fail is worse than no check.
  console.error(`  Wire fields: generated bindings not found at ${typesDir}  FAIL`);
  console.error('  The citadel-internal-service submodule must be checked out for this to run.');
  process.exit(1);
}

/** Field names per generated wire type. */
const fields = new Map();
for (const file of readdirSync(typesDir)) {
  if (!file.endsWith('.ts')) continue;
  const declaration = readFileSync(`${typesDir}/${file}`, 'utf8').match(/export type (\w+) = \{([\s\S]*?)\};/);
  if (!declaration) continue;
  const names = new Set();
  for (const field of declaration[2].matchAll(/(\w+)\s*:/g)) names.add(field[1]);
  fields.set(declaration[1], names);
}

const sources = execFileSync('git', ['ls-files', 'src'], { cwd: ui, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__') && !/\.test\.tsx?$/.test(f));

const found = [];
for (const file of sources) {
  const text = readFileSync(`${ui}/${file}`, 'utf8');
  if (!text.includes('getVariant(')) continue;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  // Scoped per declaration: `const v = getVariant(message, 'A')` appears in
  // several sibling blocks of one function, and a file-wide name map credits
  // every `v.x` in the file to whichever binding was seen last.
  const check = (scope, bindings) => {
    const local = new Map(bindings);

    const collect = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        let init = node.initializer;
        if (ts.isNonNullExpression(init)) init = init.expression;
        if (ts.isCallExpression(init) && init.expression.getText() === 'getVariant' && init.arguments.length === 2) {
          const nameArg = init.arguments[1];
          if (ts.isStringLiteral(nameArg)) local.set(node.name.getText(), nameArg.text);
        } else {
          // Re-bound to something else; it no longer names a wire message.
          local.delete(node.name.getText());
        }
      }
      if (ts.isPropertyAccessExpression(node)) {
        // Through a cast too. `(notification as { peer_username?: string })
        // .peer_username` is the same read wearing an assertion, and the
        // assertion is exactly the thing that makes it unsafe -- it silences
        // the compiler without consulting the wire. A control in this form was
        // written, did NOT fail, and is what prompted this.
        let target = node.expression;
        while (ts.isAsExpression(target) || ts.isParenthesizedExpression(target) || ts.isNonNullExpression(target)) {
          target = target.expression;
        }
        const typeName = ts.isIdentifier(target) ? local.get(target.getText()) : undefined;
        const known = typeName ? fields.get(typeName) : undefined;
        if (known && !known.has(node.name.getText())) {
          found.push(`${file}::${typeName}.${node.name.getText()}`);
        }
      }
      if (ts.isBlock(node) || ts.isSourceFile(node)) {
        check(node, local);
        return;
      }
      ts.forEachChild(node, collect);
    };

    ts.forEachChild(scope, collect);
  };
  check(sourceFile, new Map());
}

const counts = {};
for (const entry of found.sort()) counts[entry] = (counts[entry] ?? 0) + 1;

if (!existsSync(BASELINE)) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.error(`  Wire fields: recorded ${found.length} existing phantom read(s) -- commit the baseline  FAIL`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const added = Object.entries(counts).filter(([key, count]) => count > (baseline[key] ?? 0));

if (added.length > 0) {
  console.error(`  Wire fields: ${added.length} read(s) of a field the message does not carry  FAIL`);
  for (const [key, count] of added) console.error(`    ${key}  (${baseline[key] ?? 0} allowed, ${count} found)`);
  console.error('');
  console.error('  The generated binding for that type does not declare this field, so the read');
  console.error('  is `undefined` every time. Check the ts-rs type in');
  console.error('  citadel-internal-service/typescript-client/src/types/ and use a field it has.');
  process.exit(1);
}

const changed = Object.keys(baseline).length !== Object.keys(counts).length ||
  Object.entries(baseline).some(([k, v]) => (counts[k] ?? 0) !== v);
if (changed) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.error(`  Wire fields: down to ${found.length} phantom read(s) -- baseline rewritten, commit it  FAIL`);
  process.exit(1);
}

console.log(`  Wire fields: no new reads of fields the wire does not carry (${found.length} in the baseline)  ok`);
