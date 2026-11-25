/**
 * The pictures a document names, read from its model JSON (cdoc-model: every inline image is
 * `{"contentId", "width", "height", "alt"?}`, in the body, headers, footers, notes and tables
 * alike). Each id once, in document order. Used where every picture must be at hand at once:
 * an export, and storing an imported file's pictures.
 */
export function referencedPictureIds(modelJson: string): string[] {
  const ids: Set<string> = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'contentId' && typeof item === 'string') ids.add(item);
      else walk(item);
    }
  };
  walk(JSON.parse(modelJson) as unknown);
  return [...ids];
}
