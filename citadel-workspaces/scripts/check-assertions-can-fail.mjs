/**
 * An assertion no input could falsify is worse than no assertion: it reports a
 * guarantee it does not provide.
 *
 * WHY THIS FILE WAS REWRITTEN. Its first version quoted two real defects in its
 * header and detected neither of them:
 *
 *   - `expect(created).toBeTruthy()` where the helper returns `{ success, name }`.
 *     The detector required an object LITERAL immediately inside `expect(` --
 *     `expect({ … }).toBeTruthy()` -- which nobody writes. The defect is a
 *     VARIABLE holding an object.
 *   - `expect(url).toContain('/workspace')` after navigating to an office, true
 *     before the click. Not decidable from the text at all; it needs a control.
 *
 * Run against 116 specs it reported `none is of a shape that cannot fail`, and
 * the two shapes it named were among the ones it could not see. Its vacuity
 * floor counted every `expect(` in the suite -- decoupled from what the
 * detectors actually evaluated -- so it could never fire either.
 *
 * WHAT IT CHECKS NOW.
 *
 *   1. `expect(x).toBeTruthy()` / `.toBeDefined()` where `x` is declared with a
 *      type that cannot be falsy: an object, array or interface type with no
 *      `null`/`undefined` in it. This repo requires every declaration to carry a
 *      type (`check-explicit-types.mjs`), which is what makes it decidable.
 *
 *      Declarations whose initialiser contains an `as` cast are EXEMPT, and the
 *      exemption is load-bearing. `const el: HTMLElement = document.getElementById(x) as HTMLElement`
 *      declares a non-null type over a value that is `HTMLElement | null` at
 *      runtime, so `toBeTruthy()` there does discriminate. Without this
 *      exemption the rule reports a real assertion as fake -- it did, on
 *      `a-security-control-that-does-nothing-says-so.test.tsx:80`.
 *
 *   2. `not.toContain*` of a value built from `Date.now()`. The document cannot
 *      contain a string the test just minted, so the negation is free.
 *
 * SELF-TEST. Both detectors are run over known-bad fixtures below before the
 * tree is scanned, and the gate FAILS if either misses its own fixture. That is
 * the answer to a detector with an empty population: "0 findings" means nothing
 * unless the detector is known to still fire. The previous version had no such
 * proof and was inert for its whole life.
 *
 * SCOPE. Unit tests under `src/` as well as `integration-tests/src/`. The
 * assertion-quality gates all pointed only at the integration suite -- 383
 * assertions gated, 4,338 not.
 *
 * STILL NOT COVERED: an assertion true for reasons outside the test, like a URL
 * already correct before the click. That needs a negative control, and this
 * file's header is the argument for running one.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = [join(APP, 'src'), join(APP, 'integration-tests', 'src')];

/** Primitive types, every one of which has a falsy value. */
const PRIMITIVE = /^(boolean|number|string|unknown|any|void|never|bigint|symbol|null|undefined)$/;

/**
 * Split a type on `|` at depth zero.
 *
 * `{ a: string } | null` is two members; `{ a: string | null }` is one. Doing
 * this with a plain `.split('|')` is how a nullable-looking member makes an
 * object type look nullable, and how an object type containing `boolean` looked
 * falsy-capable -- both of which made this gate miss its own fixtures.
 */
function topLevelMembers(type) {
  const members = [];
  let depth = 0;
  let current = '';
  for (const ch of type) {
    if ('<{(['.includes(ch)) depth += 1;
    else if ('>})]'.includes(ch)) depth -= 1;
    if (ch === '|' && depth === 0) { members.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  members.push(current.trim());
  return members.filter(Boolean);
}

/**
 * Could some value of this type be falsy?
 *
 * Object types, array types and named non-primitive types cannot: an object is
 * truthy however empty it is, which is the whole defect. Anything nullable,
 * optional or primitive can.
 */
function couldBeFalsy(type) {
  const t = type.trim();
  if (t.includes('?')) return true;
  const members = topLevelMembers(t);
  if (members.length > 1) return members.some(couldBeFalsy);
  if (PRIMITIVE.test(t)) return true;
  if (/^['"`]/.test(t)) return true; // a string literal type; '' is falsy
  if (t.endsWith('[]')) return false;
  if (t.startsWith('{') || t.startsWith('[')) return false;
  if (/^(Array|Readonly|ReadonlyArray|Record|Map|Set|Promise)\s*</.test(t)) return false;
  // A named type. Truthy unless it is one of the primitives above.
  return !/^[A-Za-z_$][\w$.]*(\s*<.*>)?$/.test(t);
}

/**
 * `const NAME: TYPE = INIT` with a depth-aware type, because an inline object
 * type contains `;` and a naive `[^=;\n]+?` stops inside it.
 */
function typedDeclarations(source) {
  const found = [];
  const re = /\bconst\s+(\w+)\s*:\s*/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    let i = m.index + m[0].length;
    let depth = 0;
    let type = '';
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if ('<{(['.includes(ch)) depth += 1;
      else if ('>})]'.includes(ch)) depth -= 1;
      else if (ch === '=' && depth === 0 && source[i + 1] !== '>') break;
      else if ((ch === ';' || ch === '\n') && depth === 0) { type = null; break; }
      type += ch;
    }
    if (type === null || i >= source.length) continue;
    const initEnd = source.indexOf('\n', i);
    found.push({
      name: m[1],
      type: type.trim(),
      init: source.slice(i + 1, initEnd === -1 ? source.length : initEnd),
    });
  }
  return found;
}

/** `expect(x).toBeTruthy()` / `.toBeDefined()`. */
const TRUTHY_ON_NAME = /expect\s*\(\s*(\w+)\s*\)\s*\.\s*(?:toBeTruthy|toBeDefined)\s*\(/g;

/** `not.toContain…(x)` where x is, or is built from, `Date.now()`. */
const NEGATED_TIMESTAMP = /\.not\s*\.\s*toContain\w*\s*\([^)]*Date\.now\s*\(\)/;

/**
 * Findings in one file's source. A pure function, so the self-test can run it
 * over fixtures rather than over the tree.
 */
function findingsIn(source) {
  const out = [];
  const lines = source.split('\n');

  // Types of every `const` declaration, minus those whose initialiser casts:
  // an `as T` makes the declared type a claim rather than a fact.
  const types = new Map();
  for (const { name, type, init } of typedDeclarations(source)) {
    if (/\bas\s+\w/.test(init)) continue;
    types.set(name, type);
  }

  TRUTHY_ON_NAME.lastIndex = 0;
  let t;
  while ((t = TRUTHY_ON_NAME.exec(source)) !== null) {
    const type = types.get(t[1]);
    if (!type) continue;
    if (couldBeFalsy(type)) continue;
    const line = source.slice(0, t.index).split('\n').length;
    out.push({
      line,
      what: `\`expect(${t[1]})\` is truthy for every value of \`${type}\` — the assertion cannot fail`,
    });
  }

  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    if (NEGATED_TIMESTAMP.test(line)) {
      out.push({
        line: i + 1,
        what: 'negated `toContain` of a value built from `Date.now()` — nothing could match it',
      });
    }
  });

  // A local `const x = …Date.now()…` later negated.
  const minted = new Set();
  for (const m of source.matchAll(/\bconst\s+(\w+)[^=\n]*=\s*[^;\n]*Date\.now\s*\(\)/g)) minted.add(m[1]);
  for (const m of source.matchAll(/\.not\s*\.\s*toContain\w*\s*\(\s*(\w+)\s*\)/g)) {
    if (!minted.has(m[1])) continue;
    out.push({
      line: source.slice(0, m.index).split('\n').length,
      what: `\`not.toContain*(${m[1]})\` where \`${m[1]}\` is minted from \`Date.now()\` — the value cannot appear`,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Self-test. A detector with nothing to detect proves nothing about itself.
// ---------------------------------------------------------------------------
const FIXTURES = [
  {
    name: 'the header defect: toBeTruthy on a variable holding a record',
    source: [
      "const created: { success: boolean; name: string } = await createAccount(page);",
      'expect(created).toBeTruthy();',
    ].join('\n'),
  },
  {
    name: 'toBeDefined on an array, which is defined even when empty',
    source: ['const rows: string[] = await listRows(page);', 'expect(rows).toBeDefined();'].join('\n'),
  },
  {
    name: 'a negation of a freshly minted timestamp',
    source: [
      'const marker = `m-${Date.now()}`;',
      'await expect(page.locator("body")).not.toContainText(marker);',
    ].join('\n'),
  },
];

/** Inputs the detectors must NOT flag, so the self-test is two-sided. */
const CLEAN = [
  {
    name: 'a cast erases the null the runtime can still produce',
    source: [
      'const el: HTMLElement = document.getElementById(x) as HTMLElement;',
      'expect(el).toBeTruthy();',
    ].join('\n'),
  },
  {
    name: 'a nullable type can genuinely be falsy',
    source: ['const found: Row | null = rows.find(r => r.id === id) ?? null;', 'expect(found).toBeTruthy();'].join('\n'),
  },
  {
    name: 'a string can be empty',
    source: ['const name: string = await readName(page);', 'expect(name).toBeTruthy();'].join('\n'),
  },
];

const selfTestFailures = [];
for (const f of FIXTURES) {
  if (findingsIn(f.source).length === 0) selfTestFailures.push(`MISSED a known-bad fixture: ${f.name}`);
}
for (const c of CLEAN) {
  if (findingsIn(c.source).length > 0) selfTestFailures.push(`FLAGGED a known-good fixture: ${c.name}`);
}
if (selfTestFailures.length > 0) {
  console.error('FAIL: this gate no longer detects what it claims to.\n');
  for (const f of selfTestFailures) console.error(`  ${f}`);
  console.error(
    '\nThe detectors are checked against fixtures before the tree is scanned, because a\n' +
      'clean report from a detector that cannot fire is exactly the defect this gate is for.\n' +
      'Its previous version missed both defects quoted in its own header for its whole life.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The tree.
// ---------------------------------------------------------------------------
function* files(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { yield* files(full); continue; }
    if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

const present = ROOTS.filter((r) => existsSync(r));
if (present.length === 0) {
  console.error('FAIL: neither source root exists — this gate examined nothing.');
  process.exit(1);
}

const problems = [];
let filesRead = 0;
let assertionsEvaluated = 0;
let typedDecls = 0;

for (const root of present) {
  for (const file of files(root)) {
    filesRead += 1;
    const source = readFileSync(file, 'utf8');
    typedDecls += (source.match(/\bconst\s+\w+\s*:\s*[^=;\n]+?\s*=/g) ?? []).length;
    assertionsEvaluated += (source.match(/expect\s*\(\s*\w+\s*\)\s*\.\s*(?:toBeTruthy|toBeDefined)\s*\(/g) ?? []).length;
    for (const f of findingsIn(source)) {
      problems.push(`${relative(APP, file)}:${f.line}: ${f.what}`);
    }
  }
}

// Vacuity floor over what the DETECTORS consume — declarations with types and
// truthiness assertions — not over every `expect(` in the suite. The old floor
// counted the latter, so it stayed satisfied while the detectors evaluated
// nothing.
if (filesRead < 50 || typedDecls < 500 || assertionsEvaluated === 0) {
  console.error(
    `FAIL: ${filesRead} file(s), ${typedDecls} typed declaration(s), ` +
      `${assertionsEvaluated} truthiness assertion(s).\n` +
      'A zero on the last two means the detectors had nothing to read, whatever the\n' +
      'suite-wide assertion count says.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} assertion(s) no input could falsify.\n`);
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  console.error(
    '\nAssert the thing that can be wrong: a field rather than the record that holds it,\n' +
      'a value the app produces rather than one the test just minted.\n' +
      '\nThis gate sees only what is decidable from the text. An assertion true for reasons\n' +
      'outside the test — a URL already correct before the click — needs a negative control.',
  );
  process.exit(1);
}

console.log(
  `check-assertions-can-fail: ${assertionsEvaluated} truthiness assertion(s) and ${typedDecls} ` +
    `typed declaration(s) across ${filesRead} file(s); detectors self-tested against ` +
    `${FIXTURES.length} known-bad and ${CLEAN.length} known-good fixtures; none cannot fail.`,
);
