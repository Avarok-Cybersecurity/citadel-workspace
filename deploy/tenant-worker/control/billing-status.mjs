/**
 * MINIMAL STAND-IN: B1 builds this module (`billingOf(io, row)` -> `{ state, since?, purge_at? }`
 * from dunning) and the lead merges B1's in place of this one. Nothing in this worktree puts a
 * tenant into payment_required, so every tenant here is in good standing.
 */
export async function billingOf(_io, _row) {
  return { state: "ok" };
}
