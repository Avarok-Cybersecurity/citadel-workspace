/**
 * The subset of JSON Schema (draft 2020-12) the batch-1116 contract schemas use, with no
 * dependencies so the gate runs on a bare checkout. Unknown schema keywords are an error, not a
 * no-op: a schema that relies on a keyword this validator ignores would pass every fixture.
 *
 * Supported: type, properties, required, additionalProperties (boolean or schema), enum, const,
 * minimum, maximum, minLength, maxLength, pattern, items, minItems, maxItems, uniqueItems,
 * propertyNames, oneOf, anyOf, allOf, not, $ref to "#/$defs/<Name>", $defs, plus annotations
 * ($schema, $id, title, description, examples, $comment).
 */
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', 'examples', '$comment', '$defs']);
const KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'enum', 'const', 'minimum', 'maximum',
  'minLength', 'maxLength', 'pattern', 'items', 'minItems', 'maxItems', 'uniqueItems', 'propertyNames',
  'oneOf', 'anyOf', 'allOf', 'not', '$ref', 'minProperties',
]);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Errors (strings with a JSON-pointer path) of `value` against `schema`; empty means valid. */
export function validate(root, schema, value, path = '') {
  const errors = [];
  const fail = (why) => errors.push(`${path || '/'}: ${why}`);
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) throw new Error(`schema keyword ${JSON.stringify(key)} at ${path || '/'} is not supported by this validator`);
  }
  if (schema.$ref !== undefined) {
    const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(schema.$ref);
    if (!m || !root.$defs?.[m[1]]) throw new Error(`unresolvable $ref ${schema.$ref}`);
    errors.push(...validate(root, root.$defs[m[1]], value, path));
  }
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!allowed.includes(actual) && !(actual === 'integer' && allowed.includes('number'))) fail(`type is ${actual}, not ${allowed.join('|')}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => same(e, value))) fail(`${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if (schema.const !== undefined && !same(schema.const, value)) fail(`${JSON.stringify(value)} is not ${JSON.stringify(schema.const)}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`${value} > maximum ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    const chars = [...value].length;
    if (schema.minLength !== undefined && chars < schema.minLength) fail(`shorter than minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined && chars > schema.maxLength) fail(`longer than maxLength ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) fail(`${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`fewer than minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`more than maxItems ${schema.maxItems}`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) fail('items repeat');
    if (schema.items !== undefined) value.forEach((item, i) => errors.push(...validate(root, schema.items, item, `${path}/${i}`)));
  }
  if (typeOf(value) === 'object') {
    const props = schema.properties ?? {};
    for (const name of schema.required ?? []) if (!(name in value)) fail(`missing required ${JSON.stringify(name)}`);
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) fail(`fewer than minProperties ${schema.minProperties}`);
    for (const [name, v] of Object.entries(value)) {
      if (name in props) {
        errors.push(...validate(root, props[name], v, `${path}/${name}`));
      } else if (schema.additionalProperties === false) {
        fail(`unknown field ${JSON.stringify(name)}`);
      } else if (typeof schema.additionalProperties === 'object') {
        errors.push(...validate(root, schema.additionalProperties, v, `${path}/${name}`));
      }
      if (schema.propertyNames) errors.push(...validate(root, schema.propertyNames, name, `${path}/${name}`));
    }
  }
  if (schema.allOf) for (const s of schema.allOf) errors.push(...validate(root, s, value, path));
  if (schema.anyOf && !schema.anyOf.some((s) => validate(root, s, value, path).length === 0)) fail('matches none of anyOf');
  if (schema.oneOf) {
    const hits = schema.oneOf.filter((s) => validate(root, s, value, path).length === 0).length;
    if (hits !== 1) fail(`matches ${hits} of oneOf, not exactly one`);
  }
  if (schema.not && validate(root, schema.not, value, path).length === 0) fail('matches the forbidden schema');
  return errors;
}
