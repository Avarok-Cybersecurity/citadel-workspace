/**
 * Cloudflare's rule for deleting a Durable Object class, which `wrangler deploy --dry-run` cannot
 * see because only the API applies it: a deploy whose migrations delete class C is refused
 * (code 10061, "Cannot apply --delete-class migration to class 'C' without also removing the
 * binding that references it") when it keeps a binding NAME that the live Worker binds to C, even
 * if the new config points that name at another class. The binding has to go, so a new class
 * takes a new binding name. Proven on throwaway Workers and on citadel-tenant-staging (DEPLOY.md
 * "Deleting a Durable Object class").
 *
 * Pure: the live bindings come from the caller (check-do-bindings.mjs reads them from the API).
 */

/**
 * @param {{ name: string, class_name: string }[]} liveBindings the live Worker's Durable Object bindings
 * @param {{ durable_objects?: { bindings?: { name: string }[] }, migrations?: { deleted_classes?: string[] }[] }} config
 *   wrangler.toml as wrangler reads it
 * @returns {string[]} one message per binding the API would refuse; empty when the deploy may go
 */
export function bindingReuseRefusals(liveBindings, config) {
  const deleted = new Set((config.migrations ?? []).flatMap((m) => m.deleted_classes ?? []));
  const kept = new Set((config.durable_objects?.bindings ?? []).map((b) => b.name));
  return liveBindings
    .filter((b) => deleted.has(b.class_name) && kept.has(b.name))
    .map(
      (b) =>
        `binding ${b.name} is live on the deleted class ${b.class_name}: Cloudflare refuses the delete ` +
        `while a binding of that name remains; bind the new class under a new name`,
    );
}
