/**
 * Replaces the text between `<!-- billing-policy:begin ID -->` and `<!-- billing-policy:end ID -->`
 * marker lines. The markers stay as written, indentation included: an indented marker sits inside
 * a list item, so the list it is in does not split. Text outside the markers is never touched.
 * Pure: text in, text out. A missing, repeated, unclosed or unexpected marker throws.
 * The header's effective date is rendered too (applyEffectiveDate), from terms.effective_date.
 */

const MARKER = /^[ \t]*<!-- billing-policy:(begin|end) ([a-z-]+) -->$/;

/** Each block id's begin and end line indexes, or a throw naming what is wrong with them. */
function markers(lines, label) {
  const found = new Map();
  let open = null;
  lines.forEach((line, index) => {
    const m = MARKER.exec(line);
    if (m === null) {
      if (line.includes('billing-policy:')) throw new Error(`${label}:${index + 1}: a malformed billing-policy marker: ${line.trim()}`);
      return;
    }
    const [, kind, id] = m;
    if (kind === 'begin') {
      if (open !== null) throw new Error(`${label}:${index + 1}: block ${id} begins inside block ${open.id}`);
      if (found.has(id)) throw new Error(`${label}:${index + 1}: block ${id} appears twice`);
      open = { id, begin: index };
    } else {
      if (open === null || open.id !== id) throw new Error(`${label}:${index + 1}: block ${id} ends without beginning`);
      found.set(id, { begin: open.begin, end: index });
      open = null;
    }
  });
  if (open !== null) throw new Error(`${label}: block ${open.id} never ends`);
  return found;
}

/** `text` with each block's body replaced by `blocks[id]`; every id must have exactly one block. */
export function applyBlocks(text, blocks, label) {
  const lines = text.split('\n');
  const found = markers(lines, label);
  const wanted = Object.keys(blocks);
  const missing = wanted.filter((id) => !found.has(id));
  const unexpected = [...found.keys()].filter((id) => !wanted.includes(id));
  if (missing.length) throw new Error(`${label}: no billing-policy marker for block(s) ${missing.join(', ')}`);
  if (unexpected.length) throw new Error(`${label}: billing-policy block(s) ${unexpected.join(', ')} have no rendering`);
  const ordered = [...found.entries()].sort((a, b) => b[1].begin - a[1].begin);
  for (const [id, { begin, end }] of ordered) {
    const body = blocks[id] === '' ? [] : blocks[id].split('\n');
    lines.splice(begin + 1, end - begin - 1, ...body);
  }
  return lines.join('\n');
}

const HEADER = /^\*\*Version (\d+) · Effective [A-Z][a-z]+ \d{1,2}, \d{4}\*\*$/m;

/** `text` with its "**Version N · Effective DATE**" header stating `effective`; the version is left as written. */
export function applyEffectiveDate(text, effective, label) {
  const found = text.match(new RegExp(HEADER.source, 'gm'));
  if (found === null || found.length !== 1) throw new Error(`${label}: needs exactly one "**Version N · Effective DATE**" header line, found ${found?.length ?? 0}`);
  return text.replace(HEADER, (_, version) => `**Version ${version} · Effective ${effective}**`);
}
