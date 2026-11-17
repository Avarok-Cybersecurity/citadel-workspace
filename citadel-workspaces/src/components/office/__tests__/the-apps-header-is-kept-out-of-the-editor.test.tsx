/**
 * A document's required-apps header never reaches the editing buffer, and every edit hands back
 * the full stored string with the header put back byte for byte -- the string that is saved and
 * that the integrity hash is over. Control: a document without one is edited as it is.
 * The real editor pane and editor; nothing doubled.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { OfficeEditorPane } from '../OfficeEditorPane';

const HEADER: string = '{/* @citadel-apps v1 com.acme.kanban@1.2.0 */}';

function Harness({ initial, seen }: { initial: string; seen: string[] }): JSX.Element {
  const [content, setContent] = useState<string>(initial);
  const keep = (next: string): void => { seen.push(next); setContent(next); };
  return <OfficeEditorPane content={content} setContent={keep} isNewContent={false} templateCategory={null} level={{ Child: 'office' }} onSelectTemplate={() => {}} />;
}

const buffer = (): HTMLTextAreaElement => screen.getByRole('textbox') as HTMLTextAreaElement;

describe('the apps header and the editor', () => {
  it('is not in the buffer, and comes back on every edit', () => {
    const seen: string[] = [];
    render(<Harness initial={`${HEADER}\n# Board\n`} seen={seen} />);
    expect(buffer().value).toBe('# Board\n');
    fireEvent.change(buffer(), { target: { value: '' } });
    fireEvent.change(buffer(), { target: { value: '# Renamed' } });
    expect(seen).toEqual([`${HEADER}\n`, `${HEADER}\n# Renamed`]);
    expect(buffer().value).toBe('# Renamed');
  });

  it('control: a document without a header is edited whole', () => {
    const seen: string[] = [];
    render(<Harness initial={'# Board\n'} seen={seen} />);
    expect(buffer().value).toBe('# Board\n');
    fireEvent.change(buffer(), { target: { value: `${HEADER}\nx` } });
    expect(seen).toEqual([`${HEADER}\nx`]);
  });
});
