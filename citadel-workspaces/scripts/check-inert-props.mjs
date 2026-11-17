/**
 * A prop that is declared, styled, destructured -- and never passed.
 *
 * `GroupConversationRow.isActive` had a default, a class that highlights the
 * row, and one caller that never supplied it: the sidebar could not say which
 * conversation was open. `TreeNodesSection.initialExpandedIds` (since removed
 * with the expandable tree) had no caller either, and the tree forgot every
 * branch on reload. Both read as working
 * code, because the component honours the prop perfectly.
 *
 * This finds the shape mechanically: an OPTIONAL prop on a component's own
 * props type that no JSX site in the app ever passes. Required props are
 * excluded -- the compiler already refuses those. `children` is excluded: it
 * arrives as element content, not as an attribute. A component with a spread at
 * any call site is skipped entirely, because a spread can carry anything.
 *
 * Only the component's OWN top-level properties count. Recursing into nested
 * object types in the same declaration reports the fields of a callback's
 * argument -- `x`, `y`, `id`, `label` -- which no caller passes because no
 * caller ever could.
 *
 * Ratcheted against a baseline: what is here today is recorded, and a NEW inert
 * prop fails. Removing one is welcome and shrinks the file.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = resolve(APP, 'scripts', 'inert-props.baseline.json');
const WRITE = process.argv.includes('--write');

const configPath = ts.findConfigFile(APP, ts.sys.fileExists, 'tsconfig.app.json');
const parsed = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, APP,
);
const files = parsed.fileNames.filter((f) => f.includes(`${APP}/src/`));

/** Top-level OPTIONAL property names of an interface or type literal. */
function optionalProps(declaration) {
  const members = ts.isInterfaceDeclaration(declaration)
    ? declaration.members
    : ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)
      ? declaration.type.members
      : ts.isTypeLiteralNode(declaration) ? declaration.members : [];
  const names = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.questionToken) continue;
    if (!member.name || !ts.isIdentifier(member.name)) continue;
    if (member.name.text === 'children') continue;
    names.push(member.name.text);
  }
  return names;
}

const declared = new Map();   // component -> string[]
const where = new Map();      // component -> file
const passed = new Map();     // component -> Set(attr) | 'spread'

for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
  const types = new Map();

  const collectTypes = (node) => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) types.set(node.name.text, node);
    ts.forEachChild(node, collectTypes);
  };
  collectTypes(source);

  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (/^[A-Z]/.test(tag)) {
        const seen = passed.get(tag);
        if (seen !== 'spread') {
          const set = seen ?? new Set();
          for (const attr of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(attr)) { passed.set(tag, 'spread'); break; }
            if (ts.isJsxAttribute(attr) && attr.name && ts.isIdentifier(attr.name)) set.add(attr.name.text);
          }
          if (passed.get(tag) !== 'spread') passed.set(tag, set);
        }
      }
    }

    let name = null;
    let parameter = null;
    if (ts.isFunctionDeclaration(node) && node.name) { name = node.name.text; parameter = node.parameters[0]; }
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) && ts.isIdentifier(d.name)) {
          name = d.name.text; parameter = d.initializer.parameters[0];
        }
      }
    }
    if (name && /^[A-Z]/.test(name) && parameter?.type) {
      let props = [];
      if (ts.isTypeReferenceNode(parameter.type)) {
        const declaration = types.get(parameter.type.typeName.getText(source));
        if (declaration) props = optionalProps(declaration);
      } else if (ts.isTypeLiteralNode(parameter.type)) {
        props = optionalProps(parameter.type);
      }
      if (props.length > 0) { declared.set(name, props); where.set(name, relative(APP, file)); }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const found = {};
for (const [component, props] of declared) {
  const seen = passed.get(component);
  if (!seen || seen === 'spread') continue;
  const inert = props.filter((p) => !seen.has(p)).sort();
  if (inert.length > 0) found[`${where.get(component)}:${component}`] = inert;
}

if (WRITE) {
  writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`);
  console.log(`Recorded ${Object.keys(found).length} component(s) with inert props.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf-8')) : {};
const regressions = [];
for (const [key, props] of Object.entries(found)) {
  const known = new Set(baseline[key] ?? []);
  const fresh = props.filter((p) => !known.has(p));
  if (fresh.length > 0) regressions.push(`  ${key} — never passed by any caller: ${fresh.join(', ')}`);
}

if (regressions.length > 0) {
  console.log('  Props no caller passes:\n');
  console.log(regressions.join('\n'));
  console.log(`
  Each of these is honoured by the component and supplied by nobody: the
  feature is built at one end. Pass it, or delete it. If it is genuinely for a
  caller that does not exist yet, record it with --write and say why in the PR.`);
  process.exit(1);
}

const total = Object.values(found).reduce((n, p) => n + p.length, 0);
console.log(`  Inert props: no new ones (${total} in the baseline)  ok`);
