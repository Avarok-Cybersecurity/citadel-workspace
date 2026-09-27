/**
 * What a workspace may be called: the name shown for it in the workspace switcher. Pure.
 *
 * One rule for both ends: /create checks it, the tenant object checks it again before it becomes
 * the kernel's `workspace_name`, and the kernel (`resolve_workspace_name`) refuses to boot on a
 * name outside it -- so the rule here must never admit what the kernel refuses. `\p{Cc}` is the
 * set Rust's `char::is_control` tests, and 64 UTF-16 units is never more than the kernel's 64
 * chars. A lone surrogate has no UTF-8 form to write into kernel.toml.
 */

export const MAX_DISPLAY_NAME = 64;

/** The name trimmed, or null when it cannot be one. */
export function displayNameOf(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length < 1 || name.length > MAX_DISPLAY_NAME || /\p{Cc}/u.test(name) || !name.isWellFormed()) return null;
  return name;
}
