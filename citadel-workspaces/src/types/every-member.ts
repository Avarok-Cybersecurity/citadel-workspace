/**
 * A runtime list of every member of a generated string union.
 *
 * ts-rs emits types and no values, so a control that renders each variant needs the list written
 * once. `everyMember` makes that list a compile error the moment it misses a member the union
 * has, and `T` rejects one the union lacks: the drift a hand copy of an enum hides cannot build.
 */
type Missing<T extends string, L extends readonly string[]> = Exclude<T, L[number]>;

export function everyMember<T extends string>(): <const L extends readonly T[]>(
  list: L & ([Missing<T, L>] extends [never] ? unknown : { readonly missing: Missing<T, L> }),
) => L {
  return <const L extends readonly T[]>(list: L): L => list;
}
