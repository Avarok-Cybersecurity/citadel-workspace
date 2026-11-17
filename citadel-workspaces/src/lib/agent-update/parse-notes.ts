/**
 * Release notes as blocks of plain text. A small subset of Markdown (headings, bullets,
 * paragraphs) is recognised for layout and nothing else: every block carries text, which the
 * page renders as text nodes. The notes come from the network, so nothing here produces
 * markup, links or HTML.
 */
export type NotesBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'paragraph'; text: string };

const HEADING: RegExp = /^#{1,6}\s+(.*\S)\s*$/;
const BULLET: RegExp = /^\s*[-*+]\s+(.*\S)\s*$/;

export function parseNotes(notes: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  let words: string[] = [];
  const flush = (): void => {
    if (words.length > 0) blocks.push({ kind: 'paragraph', text: words.join(' ') });
    words = [];
  };
  for (const line of notes.split(/\r\n|\r|\n/)) {
    const heading: RegExpExecArray | null = HEADING.exec(line);
    const bullet: RegExpExecArray | null = BULLET.exec(line);
    if (heading || bullet || line.trim() === '') flush();
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] });
    } else if (bullet) {
      const last: NotesBlock | undefined = blocks[blocks.length - 1];
      if (last?.kind === 'list') last.items.push(bullet[1]);
      else blocks.push({ kind: 'list', items: [bullet[1]] });
    } else if (line.trim() !== '') {
      words.push(line.trim());
    }
  }
  flush();
  return blocks;
}
