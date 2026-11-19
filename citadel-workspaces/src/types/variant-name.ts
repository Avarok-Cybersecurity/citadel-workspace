/**
 * The name of a serde enum's variant, as ts-rs renders the enum: a unit variant's string, or a data
 * variant's one key. Lists and narrower unions of variant names derive from this, not a copy.
 */
export type VariantName<T> = T extends string ? T : keyof T & string;
