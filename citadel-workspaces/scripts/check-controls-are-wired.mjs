#!/usr/bin/env node
/**
 * A form control that stores nothing must not look like it stores something.
 *
 * `ChatSettingsPanel`'s Advanced tab shipped three controls with `defaultValue`,
 * no `value`, no `onChange`, no store and no consumer — among them a select
 * labelled "Encryption Level: Security level for this conversation". Choosing
 * "Maximum" changed nothing, and nothing read it.
 *
 * The comment on the switches directly above them says why that is not
 * tolerable in this product:
 *
 *   they were uncontrolled `Switch defaultChecked` here, with no handler and no
 *   store … On a product whose subject is privacy, a switch that lies about
 *   what you are broadcasting is the worst kind to fake.
 *
 * Those switches were fixed and their three siblings in the same panel were
 * not — the reason written directly above the place it was not applied.
 *
 * So: an uncontrolled control must either be `disabled` (the honest state for
 * something this build cannot act on, which `PrivacySettingsTab` pairs with a
 * note saying so) or carry a change handler. A `defaultValue` with neither is a
 * control that accepts input and discards it.
 *
 * Node 18-compatible on purpose: the lint jobs run the oldest supported Node.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';

/** Elements and primitives that take user input. */
const CONTROLS = /<(input|select|textarea|Switch|Slider|Checkbox|RadioGroup)\b/g;
const UNCONTROLLED = /\bdefault(Value|Checked)\b/;
const HANDLED = /\bon(Change|CheckedChange|ValueChange|Input)\b/;
const DISABLED = /\bdisabled\b/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let info;
    try { info = statSync(p); } catch { continue; }
    if (info.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      walk(p, out);
    } else if (entry.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SRC);
if (files.length === 0) {
  console.error('::error::found no components -- this gate is looking in the wrong place');
  process.exit(1);
}

const offences = [];
let controls = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(CONTROLS)) {
    // The opening tag's attributes: from the tag name to the first `>`.
    const from = match.index + match[0].length;
    const to = source.indexOf('>', from);
    if (to === -1) continue;
    const attributes = source.slice(from, to);
    controls += 1;

    if (!UNCONTROLLED.test(attributes)) continue;
    if (HANDLED.test(attributes) || DISABLED.test(attributes)) continue;

    offences.push({
      file: file.split('\\').join('/'),
      line: source.slice(0, match.index).split('\n').length,
      tag: match[1],
    });
  }
}

if (controls === 0) {
  console.error('::error::matched no form controls at all -- this gate cannot fail as written');
  process.exit(1);
}

if (offences.length > 0) {
  for (const o of offences) {
    console.error(
      `::error file=citadel-workspaces/${o.file},line=${o.line}::<${o.tag}> has a default value, no change handler and is not disabled, ` +
        'so it accepts input and discards it. Wire it to a store, or remove it until something can honour it.',
    );
  }
  process.exit(1);
}

console.log(`  Form controls: ${controls} checked, none accepts input it then discards  ok`);
