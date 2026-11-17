/**
 * The subset of JSON Schema 2020-12 C0's well-known schema is written in, checked strictly: a
 * keyword this does not implement is an error, never a pass. (Ajv compiles validators with
 * `new Function`, which workerd refuses, so the tests cannot run it in the Worker's runtime.)
 * Proven against C0's own valid and invalid fixtures before it judges the Worker.
 */
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);

/** The first way `value` breaks `schema`, as a path and reason, or null when it conforms. */
export function violation(schema, value, path = "$") {
  for (const [keyword, rule] of Object.entries(schema)) {
    if (ANNOTATIONS.has(keyword) || keyword === "properties") continue;
    const fail = (why) => `${path}: ${keyword} ${why}`;
    switch (keyword) {
      case "type":
        if (typeOf(value) !== rule && !(rule === "number" && typeof value === "number")) return fail(`wants ${rule}, got ${typeOf(value)}`);
        break;
      case "const":
        if (value !== rule) return fail(`wants ${JSON.stringify(rule)}`);
        break;
      case "pattern":
        if (typeof value === "string" && !new RegExp(rule, "u").test(value)) return fail("does not match");
        break;
      case "minLength":
      case "maxLength":
        if (typeof value === "string") {
          const n = [...value].length;
          if (keyword === "minLength" ? n < rule : n > rule) return fail(`is ${n}`);
        }
        break;
      case "minimum":
        if (typeof value === "number" && value < rule) return fail(`is ${value}`);
        break;
      case "maximum":
        if (typeof value === "number" && value > rule) return fail(`is ${value}`);
        break;
      case "required":
        if (typeOf(value) === "object") for (const k of rule) if (!(k in value)) return fail(`misses ${k}`);
        break;
      case "additionalProperties":
        if (rule !== false) throw new Error(`${path}: only additionalProperties: false is implemented`);
        if (typeOf(value) === "object") for (const k of Object.keys(value)) if (!(k in (schema.properties ?? {}))) return fail(`forbids ${k}`);
        break;
      case "items":
        if (Array.isArray(value)) for (const [i, item] of value.entries()) {
          const found = violation(rule, item, `${path}[${i}]`);
          if (found) return found;
        }
        break;
      case "maxItems":
        if (Array.isArray(value) && value.length > rule) return fail(`is ${value.length}`);
        break;
      case "uniqueItems":
        if (rule && Array.isArray(value) && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) return fail("repeats");
        break;
      default:
        throw new Error(`${path}: the keyword ${keyword} is not implemented`);
    }
  }
  if (typeOf(value) === "object") {
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (!(k in value)) continue;
      const found = violation(sub, value[k], `${path}.${k}`);
      if (found) return found;
    }
  }
  return null;
}
