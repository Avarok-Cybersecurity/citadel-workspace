import { ExternalLink } from 'lucide-react';
import { isReleaseLink } from '@/lib/agent-update/update-state';
import { parseNotes, type NotesBlock } from '@/lib/agent-update/parse-notes';

export interface ReleaseNotesProps {
  /** The agent's notes, when it sends them. */
  notes: string | undefined;
  /** The release page; linked only when it is this project's. */
  notesUrl: string;
  version: string;
}

function Block({ block }: { block: NotesBlock }): JSX.Element {
  if (block.kind === 'heading') return <p className="font-semibold text-foreground">{block.text}</p>;
  if (block.kind === 'list') {
    return <ul className="list-disc space-y-1 pl-5">{block.items.map((item: string, i: number) => <li key={i}>{item}</li>)}</ul>;
  }
  return <p>{block.text}</p>;
}

/**
 * What is in a release. The notes come from the network, so they are laid out as text nodes
 * (parse-notes.ts) and never as HTML. A long set scrolls inside its own focusable region.
 */
export function ReleaseNotes({ notes, notesUrl, version }: ReleaseNotesProps): JSX.Element | null {
  const blocks: NotesBlock[] = notes === undefined ? [] : parseNotes(notes);
  const linked: boolean = isReleaseLink(notesUrl);
  if (blocks.length === 0 && !linked) return null;
  return (
    <section aria-labelledby="agent-release-notes-title" className="space-y-2" data-testid="agent-release-notes">
      <h3 id="agent-release-notes-title" className="text-sm font-semibold">What is new in {version}</h3>
      {blocks.length > 0 && (
        <div role="region" aria-label={`Release notes for ${version}`} tabIndex={0}
          className="max-h-60 space-y-2 overflow-y-auto rounded-md border border-border bg-background p-3 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {blocks.map((block: NotesBlock, i: number) => <Block key={i} block={block} />)}
        </div>
      )}
      {linked && (
        <a href={notesUrl} target="_blank" rel="noopener noreferrer" data-testid="agent-release-notes-link"
          className="inline-flex items-center gap-1.5 text-sm text-primary-accent underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Full release notes on GitHub<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </section>
  );
}
