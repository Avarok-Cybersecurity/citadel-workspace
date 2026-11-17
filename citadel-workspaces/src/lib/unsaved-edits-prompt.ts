/**
 * What to ask before discarding an editor buffer.
 *
 * A plain constant, in a leaf module. It lived in `use-unsaved-mdx-guard`, so
 * every navigation source that wanted to ask the question had to import an
 * OFFICE module to get it — and `leave-editor`, which the sidebar imports,
 * dragged that graph towards the landing critical path. The bundle-budget gate
 * names this shape exactly: "an eager import in a shared provider is the usual
 * cause".
 */

export const DISCARD_EDIT_PROMPT: { readonly title: "Discard your changes?"; readonly description: "This page has edits that have not been saved. Discarding cannot be undone."; readonly confirmLabel: "Discard"; } = {
  title: 'Discard your changes?',
  description: 'This page has edits that have not been saved. Discarding cannot be undone.',
  confirmLabel: 'Discard',
} as const;
