/**
 * The old chat editor's document as ProseMirror JSON (TipTap StarterKit's schema), and its text.
 *
 * This is the walker's output and the mapper's input. It is schema-free on purpose: the walker
 * reproduces what y-prosemirror stored, node names and attributes as they are, and the mapper
 * (cdoc's StarterKit importer) decides what Citadel Docs can carry and reports the rest.
 */

export type PmAttrs = Readonly<Record<string, unknown>>;

export interface PmMark {
  readonly type: string;
  readonly attrs?: PmAttrs;
}

export interface PmNode {
  readonly type: string;
  readonly attrs?: PmAttrs;
  readonly content?: readonly PmNode[];
  readonly text?: string;
  readonly marks?: readonly PmMark[];
}

/** Blocks whose text a reader sees as a line of its own. */
const LIST_ITEM: 'listItem' = 'listItem';
const ORDERED: 'orderedList' = 'orderedList';
const HARD_BREAK: 'hardBreak' = 'hardBreak';
const RULE: 'horizontalRule' = 'horizontalRule';

function inlineText(node: PmNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === HARD_BREAK) return '\n';
  return (node.content ?? []).map(inlineText).join('');
}

function isBlockContainer(node: PmNode): boolean {
  return (node.content ?? []).some((child: PmNode): boolean => child.type !== 'text' && child.type !== HARD_BREAK);
}

function blockLines(node: PmNode, indent: string, out: string[]): void {
  if (node.type === RULE) {
    out.push(`${indent}---`);
    return;
  }
  if (!isBlockContainer(node)) {
    out.push(`${indent}${inlineText(node)}`);
    return;
  }
  const children: readonly PmNode[] = node.content ?? [];
  if (node.type === ORDERED || node.type === 'bulletList') {
    const start: number = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
    children.forEach((item: PmNode, i: number): void => {
      const bullet: string = node.type === ORDERED ? `${start + i}. ` : '- ';
      const lines: string[] = [];
      for (const block of item.type === LIST_ITEM ? item.content ?? [] : [item]) blockLines(block, '', lines);
      lines.forEach((line: string, j: number): void => {
        out.push(`${indent}${j === 0 ? bullet : ' '.repeat(bullet.length)}${line}`);
      });
    });
    return;
  }
  const nested: string = node.type === 'blockquote' ? `${indent}> ` : indent;
  for (const child of children) blockLines(child, nested, out);
}

/**
 * The document's text, a block per line: what "Show original" falls back to when Citadel Docs
 * cannot lay the original out, and what its .txt download holds.
 */
export function plainTextOf(doc: PmNode): string {
  const lines: string[] = [];
  for (const block of doc.content ?? []) blockLines(block, '', lines);
  return lines.join('\n');
}
