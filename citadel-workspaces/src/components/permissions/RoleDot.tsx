/**
 * A role's colour as a small dot. A role with no colour gets the muted one, so every role in a
 * list carries a dot and the names line up. Decorative: the role's name is always beside it.
 */
export function RoleDot({ color }: { color: string | null }): JSX.Element {
  return color === null
    ? <span aria-hidden="true" className="inline-block h-[8px] w-[8px] shrink-0 rounded-full bg-muted-foreground" />
    : <span aria-hidden="true" className="inline-block h-[8px] w-[8px] shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}
