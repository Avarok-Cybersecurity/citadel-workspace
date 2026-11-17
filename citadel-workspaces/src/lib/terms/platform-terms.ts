/**
 * The version of Avarok's platform terms the wizard shows BEFORE any session exists (`GetTerms`
 * needs one). No text here: this sits on the landing page's path, the texts do not. The server's copy is the authority: this version is what the user is told they accepted,
 * and the sign-in step records acceptance only when the server's current version is this one.
 * `legal-documents-parity.test.ts` fails when this drifts from `citadel-workspace-types`.
 */
export const SHOWN_PLATFORM_TERMS_VERSION: number = 3;
