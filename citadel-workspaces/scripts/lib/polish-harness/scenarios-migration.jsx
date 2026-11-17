/**
 * The loss banner over a chat document that moved to Citadel Docs, in its widest state: a report
 * with long entries, a conflict, and the original shown as text (the mapper-failed fallback),
 * right-to-left lines and an unbroken token included, the hardest content for its width.
 */
import { LossReportBanner } from '@/components/documents/migration/LossReportBanner';

const NOOP_FILES = { save: () => {}, nowRfc3339: () => '2026-10-22T00:00:00Z' };
const NO_RUNTIME = () => new Promise(() => {});
const REPORT = {
  losses: [
    { kind: 'counted', part: 'the document body, every paragraph in it', what: 'strikethrough and inline code inside headings', count: 12, severity: 'minor', label: 'Formatting simplified' },
    { kind: 'counted', part: 'this device', what: 'edits made here before the document’s creator moved it; they are kept in a conflicted copy', count: 6, severity: 'major', label: 'Not in the shared copy' },
  ],
  problems: ['a list item held a block the new editor does not have'],
};
const TEXT = [
  'Quarterly planning — design, engineering and operations',
  '- שלום עולם — مرحبا بالعالم, mixed with English words in one line that is long enough to wrap twice on a phone',
  `  1. ${'https://example.com/'.concat('a'.repeat(160))}`,
  '> quoted line',
].join('\n');
const ORIGINAL = { title: 'Quarterly planning', docsPm: null, text: TEXT };

export const MIGRATION_SCENARIOS = {
  'migration-banner': () => (
    <div style={{ maxWidth: '100%' }}>
      <LossReportBanner docId="d1" report={REPORT} conflict="adopt-creator" loadOriginal={() => Promise.resolve(ORIGINAL)} files={NOOP_FILES} loadCdocRuntime={NO_RUNTIME} />
    </div>
  ),
};
