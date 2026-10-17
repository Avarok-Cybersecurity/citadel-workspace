/**
 * The jobs and steps of a GitHub workflow, read by indentation, matrix rows expanded.
 *
 * Pure: text in, data out. Preflight reads TWO workflows this way -- the parent's and the UI
 * repo's -- and a gate list hand-copied from either is the failure preflight exists to end.
 *
 * Not a YAML parser, on purpose: preflight runs on a bare checkout, and a gate that needs an
 * install is a gate that does not run. It relies on the layout both workflows use (jobs at two
 * spaces, job keys at four, steps at six, step keys at eight) and FAILS on a shape it cannot
 * read rather than returning fewer steps.
 */

const JOB = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/;
const STEP = /^ {6}- /;

const unquote = (value) => {
  const v = value.trim();
  return /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v;
};
const stripComment = (value) => value.replace(/\s+#.*$/, '');
const indent = (line) => line.length - line.trimStart().length;
const meaningful = (line) => line.trim() !== '' && !line.trim().startsWith('#');

/** `{ a: b, c: 'd, e' }` -> { a: 'b', c: 'd, e' }. Commas inside quotes do not split. */
export function parseFlowMap(text) {
  const body = text.trim().replace(/^\{/, '').replace(/\}$/, '');
  const parts = [];
  let current = '';
  let quote = null;
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return Object.fromEntries(parts.map((part) => {
    const at = part.indexOf(':');
    if (at < 0) throw new Error(`workflow: cannot read flow mapping entry '${part.trim()}'`);
    return [part.slice(0, at).trim(), unquote(part.slice(at + 1))];
  }));
}

/** The keys directly under a block at `depth`, with each key's own nested lines. */
function children(lines, depth) {
  const out = [];
  for (const line of lines) {
    if (!meaningful(line)) continue;
    if (indent(line) === depth) out.push({ head: line.trim(), body: [] });
    else if (indent(line) > depth && out.length > 0) out[out.length - 1].body.push(line);
    else if (indent(line) < depth) break;
  }
  return out;
}

/** List items of one matrix axis: scalars, flow maps, or block maps. */
function axisValues(head, body) {
  const inline = /^[^:]+:\s*\[(.*)\]\s*$/.exec(head);
  if (inline) return inline[1].split(',').map(unquote).filter(Boolean);
  const items = [];
  for (const line of body) {
    if (!meaningful(line)) continue;
    const t = line.trim();
    if (t.startsWith('- ')) {
      const value = stripComment(t.slice(2));
      if (value.startsWith('{')) items.push(parseFlowMap(value));
      else if (/^[A-Za-z0-9_-]+:/.test(value)) items.push(Object.fromEntries([splitPair(value)]));
      else items.push(unquote(value));
    } else if (items.length > 0 && typeof items[items.length - 1] === 'object') {
      const [k, v] = splitPair(stripComment(t));
      items[items.length - 1][k] = v;
    } else {
      throw new Error(`workflow: cannot read matrix line '${t}'`);
    }
  }
  return items;
}

function splitPair(text) {
  const at = text.indexOf(':');
  return [text.slice(0, at).trim(), unquote(text.slice(at + 1))];
}

/** Every matrix row of a job; `[{}]` for a job with no matrix. */
export function matrixRows(jobLines) {
  const start = jobLines.findIndex((line) => /^ {6}matrix:\s*$/.test(line));
  if (start < 0) return [{}];
  const block = [];
  for (const line of jobLines.slice(start + 1)) {
    if (meaningful(line) && indent(line) <= 6) break;
    block.push(line);
  }
  let rows = [{}];
  let include = null;
  for (const { head, body } of children(block, 8)) {
    const key = head.split(':')[0].trim();
    const values = axisValues(head, body);
    if (key === 'include') { include = values; continue; }
    rows = rows.flatMap((row) => values.map((value) => ({ ...row, [key]: value })));
  }
  if (include) {
    if (rows.length > 1 || Object.keys(rows[0]).length > 0) {
      throw new Error('workflow: a matrix with both axes and `include:` is not supported here');
    }
    rows = include;
  }
  return rows;
}

const lookup = (row, path) => path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), row);

/** `${{ matrix.a.b }}` replaced from the row; any other expression is left in place. */
export function substitute(text, row) {
  return text.replace(/\$\{\{\s*matrix\.([A-Za-z0-9_.-]+)\s*\}\}/g, (whole, path) => {
    const value = lookup(row, path);
    return typeof value === 'string' || typeof value === 'number' ? String(value) : whole;
  });
}

/**
 * Whether a step runs for this matrix row. `matrix.x == 'v'` and `!=` are decided; `failure()`
 * and `cancelled()` never hold locally; anything else (event names, step outputs) holds, so a
 * gate CI runs under SOME condition is run here rather than silently dropped.
 */
export function stepRuns(condition, row) {
  if (!condition) return true;
  const expr = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  if (/[()]/.test(expr.replace(/\b(failure|cancelled|always|success)\(\)/g, ''))) return true;
  return expr.split('||').some((alt) => alt.split('&&').every((atom) => {
    const a = atom.trim();
    if (/^(failure|cancelled)\(\)$/.test(a)) return false;
    const cmp = /^matrix\.([A-Za-z0-9_.-]+)\s*(==|!=)\s*'([^']*)'$/.exec(a);
    if (!cmp) return true;
    const equal = String(lookup(row, cmp[1])) === cmp[3];
    return cmp[2] === '==' ? equal : !equal;
  }));
}

/** `key: value` pairs of an indented block (env:, with:). */
function blockPairs(lines, depth) {
  return Object.fromEntries(children(lines, depth).map(({ head }) => splitPair(stripComment(head))));
}

function readStep(lines) {
  const first = lines[0].replace(/^ {6}- /, '        ');
  const own = [first, ...lines.slice(1)];
  const step = { text: lines.join('\n'), name: null, run: null, wd: null, if: null, env: {}, uses: null, with: {} };
  for (const { head, body } of children(own, 8)) {
    const [key, value] = splitPair(head);
    if (key === 'run') {
      step.run = /^[|>][-+]?$/.test(value) ? body.map((l) => l.slice(10)).join('\n') : stripComment(value);
    } else if (key === 'working-directory') step.wd = stripComment(value);
    else if (key === 'if') step.if = stripComment(value);
    else if (key === 'name') step.name = stripComment(value);
    else if (key === 'uses') step.uses = stripComment(value);
    else if (key === 'env') step.env = blockPairs(body, 10);
    else if (key === 'with') step.with = blockPairs(body, 10);
  }
  return step;
}

/** Workflow-level `env:` literals. */
export function workflowEnv(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^env:\s*$/.test(line));
  if (start < 0) return {};
  const end = lines.findIndex((line, i) => i > start && meaningful(line) && indent(line) === 0);
  return blockPairs(lines.slice(start + 1, end < 0 ? undefined : end), 2);
}

/** Every job: its id, default directory, setup-node major, env, matrix rows and steps. */
export function readJobs(text) {
  const lines = text.split('\n');
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsAt < 0) throw new Error('workflow: no top-level `jobs:` key');
  const jobs = [];
  for (const line of lines.slice(jobsAt + 1)) {
    if (meaningful(line) && indent(line) === 0) break;
    const match = JOB.exec(line);
    if (match) jobs.push({ id: match[1], lines: [] });
    else if (jobs.length > 0) jobs[jobs.length - 1].lines.push(line);
  }
  return jobs.map(({ id, lines: body }) => {
    const stepsAt = body.findIndex((line) => /^ {4}steps:\s*$/.test(line));
    const steps = [];
    if (stepsAt >= 0) {
      for (const line of body.slice(stepsAt + 1)) {
        if (meaningful(line) && indent(line) <= 4) break;
        if (STEP.test(line)) steps.push([line]);
        else if (steps.length > 0) steps[steps.length - 1].push(line);
      }
    }
    const header = stepsAt >= 0 ? body.slice(0, stepsAt) : body;
    const defaults = /^ {4}defaults:\s*\n {6}run:\s*\n {8}working-directory:\s*(\S+)/m.exec(header.join('\n'));
    const envAt = header.findIndex((line) => /^ {4}env:\s*$/.test(line));
    const parsed = steps.map(readStep);
    const setup = parsed.find((s) => s.uses?.startsWith('actions/setup-node'));
    const version = setup?.with['node-version'];
    return {
      id,
      defaultWd: defaults ? unquote(defaults[1]) : null,
      nodeMajor: version ? Number.parseInt(version, 10) : null,
      env: envAt < 0 ? {} : blockPairs(header.slice(envAt + 1), 6),
      rows: matrixRows(header),
      steps: parsed,
    };
  });
}
