// Refuses a vitest run started at the repository root (scripts/lib/root-vitest.mjs says why).
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootVitestRefusal } from './scripts/lib/root-vitest.mjs';

const refusal = rootVitestRefusal({ cwd: realpathSync(process.cwd()), root: realpathSync(dirname(fileURLToPath(import.meta.url))) });
if (refusal !== null) throw new Error(refusal);

export default {};
