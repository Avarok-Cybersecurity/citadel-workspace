/** The picture access of a test that inserts or fetches no pictures: explicit, as production's is. */
import type { PictureAccess } from '../pictures/document-pictures';

export const NO_PICTURES: PictureAccess = { kind: 'none', reason: 'This test keeps no pictures.' };
