/**
 * Finding hand-written copies of generated types: the pure half of
 * check-no-hand-copies-of-generated-types.mjs (that file reads the tree; this one decides).
 *
 * A declaration is a copy when it restates what a generated type already says:
 *   - it takes a generated type's NAME without deriving from it;
 *   - its fields are mostly a generated type's fields (or a request variant's body);
 *   - it is a string-literal union, enum, or runtime list of a generated enum's variants
 *     that nothing types against the generated enum;
 *   - it is an untyped object whose keys are a generated type's field names (a fixture or a
 *     field-name table the compiler cannot hold to the wire).
 * A declaration that REFERENCES a generated type (`Pick<X, ...>`, `X & {...}`, `satisfies X[]`,
 * `everyMember<X>()([...])`) derives from it and is not a copy.
 */

const ENVELOPE = new Set(['cid', 'request_id', 'peer_cid']);
const CONTAINERS = new Set(['Array', 'ReadonlyArray', 'Set', 'ReadonlySet', 'Map', 'ReadonlyMap', 'Record', 'Readonly', 'Partial', 'const']);
const unquote = (s) => s.replace(/^["'`]|["'`]$/g, '');

function nameOf(ts, node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return unquote(node.getText());
}

/**
 * Identifiers a type or expression is built from. A property's own type inside an object literal
 * does not count: `{ a: Foo; b: string }` restates a shape that happens to hold a Foo, while
 * `Pick<Foo, 'a'>` and `Foo & { b: string }` derive from Foo.
 */
function mentions(ts, node) {
  const out = new Set();
  const visit = (n) => {
    if (ts.isPropertySignature(n)) return;
    if (ts.isTypeReferenceNode(n)) out.add(n.typeName.getText().split('.')[0]);
    else if (ts.isExpressionWithTypeArguments(n)) out.add(n.expression.getText().split('.')[0]);
    else if (ts.isIdentifier(n)) out.add(n.text);
    ts.forEachChild(n, visit);
  };
  if (node) visit(node);
  return out;
}

/** Fields, string literals and variant bodies of a type node. */
function shapeOf(ts, node) {
  const fields = new Set();
  const literals = new Set();
  const variants = [];
  const members = (lit) => lit.members.filter((m) => ts.isPropertySignature(m) || ts.isMethodSignature(m));
  const visit = (t) => {
    if (!t) return;
    if (ts.isParenthesizedTypeNode(t)) return visit(t.type);
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) return void literals.add(t.literal.text);
    if (ts.isTypeLiteralNode(t)) return members(t).forEach((m) => fields.add(nameOf(ts, m.name)));
    if (ts.isUnionTypeNode(t)) {
      // serde's externally tagged enum: every member a unit-variant string or a one-key object.
      const tagged = t.types.length > 1 && t.types.every((m) => (ts.isLiteralTypeNode(m) && ts.isStringLiteral(m.literal)) || (ts.isTypeLiteralNode(m) && members(m).length === 1))
        && t.types.some(ts.isTypeLiteralNode);
      for (const member of t.types) {
        if (!ts.isTypeLiteralNode(member)) { visit(member); continue; }
        const props = members(member);
        if (props.length === 1 && tagged) {
          const tag = nameOf(ts, props[0].name);
          literals.add(tag);
          if (props[0].type && ts.isTypeLiteralNode(props[0].type)) variants.push({ tag, shape: shapeOf(ts, props[0].type) });
        } else {
          for (const p of props) {
            fields.add(nameOf(ts, p.name));
            if (p.type && ts.isLiteralTypeNode(p.type) && ts.isStringLiteral(p.type.literal)) literals.add(p.type.literal.text);
          }
        }
      }
      return;
    }
    if (ts.isIntersectionTypeNode(t)) t.types.forEach(visit);
  };
  visit(node);
  return { fields, literals, variants };
}

function unwrap(ts, expr) {
  let e = expr;
  while (e && (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e))) e = e.expression;
  if (e && ts.isCallExpression(e) && e.expression.getText() === 'Object.freeze' && e.arguments[0]) return unwrap(ts, e.arguments[0]);
  if (e && ts.isNewExpression(e) && e.arguments?.[0] && ts.isArrayLiteralExpression(e.arguments[0])) return e.arguments[0];
  return e;
}

/** Types a value is held to: its annotation, and every `as`/`satisfies` around its initializer. */
function typingsOf(ts, decl) {
  const out = new Set(mentions(ts, decl.type));
  for (let e = decl.initializer; e && (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)); e = e.expression) {
    if (e.type) mentions(ts, e.type).forEach((m) => out.add(m));
  }
  if (decl.initializer && ts.isNewExpression(decl.initializer)) mentions(ts, decl.initializer.typeArguments?.[0]).forEach((m) => out.add(m));
  return out;
}

/** Every declaration in one file that could restate a generated type. */
export function declarationsOf(ts, path, text) {
  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.[mc]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out = [];
  // `import type { X as WireX }`: a reference to WireX is a reference to X.
  const aliases = new Map();
  for (const st of sf.statements) {
    const named = ts.isImportDeclaration(st) ? st.importClause?.namedBindings : null;
    if (named && ts.isNamedImports(named)) for (const el of named.elements) if (el.propertyName) aliases.set(el.name.text, el.propertyName.text);
  }
  const resolve = (refs) => new Set([...refs].map((r) => aliases.get(r) ?? r));
  const visit = (n) => {
    // `declare global { interface Window ... }` augments a platform type; it restates nothing generated.
    if (ts.isModuleDeclaration(n)) return;
    if (ts.isInterfaceDeclaration(n)) {
      const fields = new Set(n.members.filter((m) => m.name).map((m) => nameOf(ts, m.name)));
      const refs = resolve((n.heritageClauses ?? []).flatMap((h) => [...mentions(ts, h)]));
      out.push({ path, line: line(n), name: n.name.text, kind: 'interface', fields, literals: new Set(), variants: [], refs });
    } else if (ts.isTypeAliasDeclaration(n)) {
      out.push({ path, line: line(n), name: n.name.text, kind: 'type', ...shapeOf(ts, n.type), refs: resolve(mentions(ts, n.type)) });
    } else if (ts.isEnumDeclaration(n)) {
      const literals = new Set();
      for (const m of n.members) {
        literals.add(nameOf(ts, m.name));
        if (m.initializer && ts.isStringLiteral(m.initializer)) literals.add(m.initializer.text);
      }
      out.push({ path, line: line(n), name: n.name.text, kind: 'enum', fields: new Set(), literals, variants: [], refs: new Set() });
    } else if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
      const init = unwrap(ts, n.initializer);
      const refs = resolve(typingsOf(ts, n));
      const base = { path, line: line(n), name: n.name.text, fields: new Set(), literals: new Set(), variants: [], refs };
      if (init && ts.isArrayLiteralExpression(init) && init.elements.length >= 2 && init.elements.every(ts.isStringLiteralLike)) {
        out.push({ ...base, kind: 'const-list', literals: new Set(init.elements.map((e) => e.text)) });
      } else if (init && ts.isObjectLiteralExpression(init) && init.properties.length >= 2) {
        const props = init.properties.filter((p) => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p));
        const literals = new Set(props.filter((p) => ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)).map((p) => p.initializer.text));
        out.push({ ...base, kind: 'const-object', fields: new Set(props.map((p) => nameOf(ts, p.name))), literals });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The generated declarations, with each tagged union's variant bodies as `Union.Variant`. */
export function generatedCatalogue(decls) {
  const all = [];
  for (const d of decls) {
    if (d.kind.startsWith('const')) continue;
    all.push(d);
    for (const v of d.variants) all.push({ ...d, name: `${d.name}.${v.tag}`, kind: 'variant', ...v.shape, variants: [] });
  }
  return all;
}

/** Names that are, or are derived from, a generated type: aliases that reference one, to a fixpoint. */
export function derivedNames(generated, hand) {
  const names = new Set(generated.map((g) => g.name));
  let grew = true;
  while (grew) {
    grew = false;
    for (const h of hand) {
      if (names.has(h.name) || h.kind === 'const-list' || h.kind === 'const-object') continue;
      if ([...h.refs].some((r) => names.has(r))) { names.add(h.name); grew = true; }
    }
  }
  return names;
}

function bestShape(h, generated) {
  const hf = [...h.fields];
  let best = null;
  for (const g of generated) {
    if (g.fields.size === 0) continue;
    const shared = hf.filter((f) => g.fields.has(f));
    const meaningful = shared.filter((f) => !ENVELOPE.has(f)).length;
    const object = h.kind === 'const-object';
    const ok = object
      ? meaningful >= 3 && shared.length / hf.length >= 0.8
      : shared.length >= 3 && meaningful >= 2 && shared.length / hf.length >= 0.7 && shared.length / g.fields.size >= 0.5;
    const score = shared.length / Math.max(hf.length, g.fields.size);
    if (ok && (!best || score > best.score)) best = { g, score, why: `${shared.length} of its ${hf.length} fields are ${g.name}'s (${g.fields.size})` };
  }
  return best;
}

function bestLiterals(h, generated) {
  const hl = [...h.literals];
  let best = null;
  for (const g of generated) {
    if (g.literals.size < 2) continue;
    const shared = hl.filter((l) => g.literals.has(l));
    const all = shared.length === hl.length;
    const ok = hl.length >= 2 && all && (hl.length >= 3 || hl.length === g.literals.size);
    const score = shared.length / Math.max(hl.length, g.literals.size);
    if (ok && (!best || score > best.score)) best = { g, score, why: `its ${hl.length} strings are variants of ${g.name} (${g.literals.size})` };
  }
  return best;
}

/**
 * `{ path, line, name, rule, generated, why }` for every hand copy not on the allowlist.
 *
 * A generated declaration may carry `scope`, the path prefixes it is visible to: an app's own
 * bindings (the calendar's `Window`, a time range) say nothing about the UI's global `Window`.
 */
export function findHandCopies(generated, hand, allow) {
  const catalogue = generatedCatalogue(generated);
  const derived = derivedNames(catalogue, hand);
  const visible = new Map();
  const forPath = (path) => {
    const key = catalogue.filter((g) => g.scope).map((g) => g.scope.some((p) => path.startsWith(p))).join();
    if (!visible.has(key)) {
      const seen = catalogue.filter((g) => !g.scope || g.scope.some((p) => path.startsWith(p)));
      visible.set(key, { seen, byName: new Map(seen.map((g) => [g.name, g])) });
    }
    return visible.get(key);
  };
  const findings = [];
  for (const h of hand) {
    if (allow.has(`${h.path}#${h.name}`)) continue;
    const { seen: catalogueHere, byName } = forPath(h.path);
    // A type is a copy unless it derives from a generated one. A value held to ANY declared type
    // (not just string[]) answers to that type; if the type is itself a copy, its own rule says so.
    const typed = h.kind.startsWith('const')
      ? [...h.refs].some((r) => !CONTAINERS.has(r))
      : [...h.refs].some((r) => derived.has(r));
    const report = (rule, g, why) => findings.push({ path: h.path, line: h.line, name: h.name, rule, generated: g.name, why });
    if (!h.kind.startsWith('const') && byName.has(h.name) && !typed) {
      report('same-name', byName.get(h.name), `declares ${h.name} again instead of importing it`);
      continue;
    }
    if (typed) continue;
    const shape = h.kind === 'enum' ? null : bestShape(h, catalogueHere);
    if (shape) { report(h.kind === 'const-object' ? 'untyped-fields' : 'shape', shape.g, shape.why); continue; }
    if (h.kind === 'interface' || (h.kind === 'const-object' && h.literals.size < 2)) continue;
    const literals = bestLiterals(h, catalogueHere);
    if (literals) report('variants', literals.g, literals.why);
  }
  return findings;
}
