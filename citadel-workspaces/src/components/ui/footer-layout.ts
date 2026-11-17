/**
 * The one layout of a dialog's, alert's and sheet's footer: answers stacked on a phone, in a
 * right-aligned row from `sm`.
 *
 * The row wraps, and each answer may break its label anywhere (the `data-dialog-footer` rule in
 * index.css). A name is often a username, one unbreakable token, and the Button primitive does not
 * wrap: one long label made the row wider than the dialog, and justify-end sent the overflow out of
 * the dialog's LEFT edge, which no scroll can reach. The answer there kept its box but a click at it
 * landed on the overlay (AlwaysAcceptDialog, "Always accept from file_alice_1794760367429").
 * Short labels lay out exactly as before: nothing wraps that fits.
 */
export const FOOTER_LAYOUT: string = 'flex flex-col-reverse sm:flex-row sm:flex-wrap sm:justify-end sm:gap-y-2 sm:space-x-2';
