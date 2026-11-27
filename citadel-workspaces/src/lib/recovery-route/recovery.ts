/**
 * What a surface hands the renderer: its id and the binding its plan needs. The binding's type is
 * read off the registry entry, so the compiler checks it against the plan the id names.
 */
import type { BindingOf } from './binding';
import type { SurfaceId, SurfacePlan } from './surfaces';

/**
 * Distributive: `Recovery` with no argument is the union of every surface's own pairing, so a
 * caller holding any one surface's recovery can pass it where any recovery is taken.
 */
export type Recovery<S extends SurfaceId = SurfaceId> = S extends SurfaceId
  ? { readonly surface: S; readonly binding: BindingOf<SurfacePlan<S>> }
  : never;

/** Ties an id to its binding; `recovery('apps.Unavailable', { askAbout })` and nothing less. */
export function recovery<S extends SurfaceId>(surface: S, binding: BindingOf<SurfacePlan<S>>): Recovery<S> {
  // The compiler cannot see a generic S through the distribution; for one S the shapes are equal.
  return { surface, binding } as Recovery<S>;
}
