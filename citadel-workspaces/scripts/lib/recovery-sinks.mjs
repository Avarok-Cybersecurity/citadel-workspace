/**
 * Where the app tells a person something failed, found mechanically (RECOVERY-DESIGN.md §4.1).
 * Shared by the dead-end gate and the UX score, so the two never disagree about what a dead end is.
 *
 * A RAW sink is a failure shown by hand: a destructive toast with no action, `toast.error` with no
 * action, `role="alert"`, `<Alert variant="destructive">`, `window.alert`. Each is a dead-end
 * candidate: it may carry a way out in its text or beside it, but nothing declares one.
 * A DECLARED sink goes through the one renderer (`<RecoveryNotice>`, `recoveryToast()`) and so
 * names a surface whose plan says what to do next.
 *
 * The renderer's own files are not sinks: they are where declared surfaces are drawn.
 *
 * Also found, and ratcheted apart (they are not dead ends, so they do not touch the score): copy
 * catch-alls, `Partial<Record<…>>` and a `switch` whose `default` returns a sentence.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const RENDERER_DIRS = ['src/components/recovery-route/', 'src/components/bug-report/', 'src/lib/recovery-route/'];

function hasProperty(object, name) {
  return object.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === name);
}

function stringProperty(object, name) {
  const found = object.properties.find((p) => ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === name);
  return found && ts.isStringLiteralLike(found.initializer) ? found.initializer.text : null;
}

function jsxStringAttribute(node, name) {
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !attr.name || attr.name.getText() !== name || !attr.initializer) continue;
    if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  }
  return null;
}

/** Raw sinks of one source file, as kind → count, and how many declared sinks it has. */
export function sinksOf(fileName, text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const raw = {};
  let declared = 0;
  const surfaces = new Set();
  const catchAlls = {};
  const add = (kind) => { raw[kind] = (raw[kind] ?? 0) + 1; };
  const addCatchAll = (kind) => { catchAlls[kind] = (catchAlls[kind] ?? 0) + 1; };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      const [first, second] = node.arguments;
      if (callee === 'toast' && first && ts.isObjectLiteralExpression(first) && stringProperty(first, 'variant') === 'destructive' && !hasProperty(first, 'action')) add('toast-destructive');
      if (callee === 'toast.error' && !(second && ts.isObjectLiteralExpression(second) && hasProperty(second, 'action'))) add('toast-error');
      if (callee === 'window.alert' || callee === 'alert') add('window-alert');
      if (callee === 'recoveryToast') declared += 1;
      // recovery('call.failed', …): the surface a screen draws. Only a literal names one.
      if (callee === 'recovery' && first && ts.isStringLiteralLike(first)) surfaces.add(first.text);
      // domFallback(root, 'app.boot-failed', …): a declared surface drawn before React exists.
      if (callee === 'domFallback' && second && ts.isStringLiteralLike(second)) { declared += 1; surfaces.add(second.text); }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (tag === 'RecoveryNotice') declared += 1;
      else if (tag === 'Alert' && jsxStringAttribute(node, 'variant') === 'destructive') add('alert-destructive');
      else if (jsxStringAttribute(node, 'role') === 'alert') add('role-alert');
    }
    // Copy that answers every case it was not written for: a map that may miss keys, or a switch
    // whose default returns a sentence. A new wire variant then reads as the old generic words.
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(source) === 'Partial'
      && node.typeArguments?.[0] && ts.isTypeReferenceNode(node.typeArguments[0]) && node.typeArguments[0].typeName.getText(source) === 'Record') addCatchAll('partial-record');
    if (ts.isDefaultClause(node)) {
      const first = node.statements[0];
      const value = first && ts.isReturnStatement(first) ? first.expression : undefined;
      if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) || ts.isTemplateExpression(value))) addCatchAll('switch-default-copy');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { raw, declared, surfaces, catchAlls };
}

/**
 * Every app source file's sinks, keyed `path:kind` → count; the declared total; and the surface
 * ids some screen draws (a plan nobody draws is not a way out anybody sees).
 */
export function scanApp(app) {
  const configPath = ts.findConfigFile(app, ts.sys.fileExists, 'tsconfig.app.json');
  const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, app);
  const files = parsed.fileNames.filter((f) => f.startsWith(resolve(app, 'src') + '/') && !f.includes('/__tests__/'));
  const deadEnds = {};
  const catchAllCopy = {};
  const drawn = new Set();
  let declared = 0;
  for (const file of files) {
    const path = relative(app, file);
    const { raw, declared: here, surfaces, catchAlls } = sinksOf(file, readFileSync(file, 'utf-8'));
    declared += here;
    for (const id of surfaces) drawn.add(id);
    for (const [kind, count] of Object.entries(catchAlls)) catchAllCopy[`${path}:${kind}`] = count;
    if (RENDERER_DIRS.some((dir) => path.startsWith(dir))) continue;
    for (const [kind, count] of Object.entries(raw)) deadEnds[`${path}:${kind}`] = count;
  }
  return { deadEnds, catchAllCopy, declared, drawn: [...drawn].sort() };
}
