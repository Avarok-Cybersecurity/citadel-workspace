import React, { useState, useRef } from 'react';
import { MediaUploader } from './MediaUploader';
import { MDXToolbar } from './MDXToolbar';

interface MDXEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  placeholder?: string;
}

export const MDXEditor: React.FC<MDXEditorProps> = ({
  value,
  onChange,
  height = '400px',
  placeholder = 'Write your content here...'
}) => {
  const textAreaRef: React.RefObject<HTMLTextAreaElement> = useRef<HTMLTextAreaElement>(null);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [mediaUploaderOpen, setMediaUploaderOpen] = useState(false);

  // Track selection changes
  const handleSelectionChange = (): void => {
    if (textAreaRef.current) {
      setSelectionStart(textAreaRef.current.selectionStart);
      setSelectionEnd(textAreaRef.current.selectionEnd);
    }
  };

  // Format helpers
  const formatText = (
    prefix: string,
    suffix: string = prefix,
  ): void => {
    if (!textAreaRef.current) return;

    const textarea: HTMLTextAreaElement = textAreaRef.current;
    const start: number = textarea.selectionStart;
    const end: number = textarea.selectionEnd;
    const selectedText: string = value.substring(start, end);

    if (selectedText) {
      const newText: string = `${value.substring(0, start)}${prefix}${selectedText}${suffix}${value.substring(end)}`;
      onChange(newText);

      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(
          start + prefix.length,
          end + prefix.length
        );
      }, 0);
    } else {
      const newText: string = `${value.substring(0, start)}${prefix}${suffix}${value.substring(end)}`;
      onChange(newText);

      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(
          start + prefix.length,
          start + prefix.length
        );
      }, 0);
    }
  };

  /** Returns focus to the editor after React applies the new value, caret at `at`. */
  const restoreCaret = (textarea: HTMLTextAreaElement, at: number): void => {
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(at, at);
    }, 0);
  };

  // Format handlers
  const handleBold = (): void => formatText('**');
  const handleItalic = (): void => formatText('*');
  const handleUnderline = (): void => formatText('__');
  const handleCode = (): void => formatText('`');
  // Prefix-only markup passes an empty suffix: formatText's default repeats the prefix,
  // right for **bold**, and it inserted "> > ", "- - " and a link twice (measured live).
  const handleBlockquote = (): void => formatText('> ', '');

  const handleHeading = (level: number): void => {
    const prefix: string = '#'.repeat(level) + ' ';
    if (!textAreaRef.current) return;

    const textarea: HTMLTextAreaElement = textAreaRef.current;
    const start: number = textarea.selectionStart;
    const lineStart: number = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd: number = value.indexOf('\n', start);
    const line: string = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);

    const existingHeadingMatch: RegExpMatchArray | null = line.match(/^(#{1,6})\s/);

    let newText: string;
    if (existingHeadingMatch) {
      const existingPrefix: string = existingHeadingMatch[0];
      newText = value.substring(0, lineStart) + prefix + line.substring(existingPrefix.length) + value.substring(lineEnd === -1 ? value.length : lineEnd);
    } else {
      newText = value.substring(0, lineStart) + prefix + line + value.substring(lineEnd === -1 ? value.length : lineEnd);
    }

    onChange(newText);
    // Back to the editor, caret after the prefix: the button kept focus, so typing went nowhere.
    restoreCaret(textarea, start + (newText.length - value.length));
  };

  const handleLink = (): void => {
    const selectedText: string = value.substring(selectionStart, selectionEnd);

    if (selectedText) {
      formatText('[', '](url)');
    } else {
      formatText('[Link text](url)', '');
    }
  };

  const handleImage = (): void => {
    setMediaUploaderOpen(true);
  };

  const handleMediaInsert = (markdownText: string): void => {
    if (!textAreaRef.current) return;

    const textarea: HTMLTextAreaElement = textAreaRef.current;
    const start: number = textarea.selectionStart;

    const newText: string = value.substring(0, start) + markdownText + value.substring(start);
    onChange(newText);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos: number = start + markdownText.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleList = (ordered: boolean = false): void => {
    if (!textAreaRef.current) return;

    const textarea: HTMLTextAreaElement = textAreaRef.current;
    const start: number = textarea.selectionStart;
    const end: number = textarea.selectionEnd;

    if (start === end) {
      const prefix: "1. " | "- " = ordered ? '1. ' : '- ';
      formatText(prefix, '');
    } else {
      const selectedText: string = value.substring(start, end);
      const lines: string[] = selectedText.split('\n');

      const formattedLines: string[] = lines.map((line, index) => {
        if (line.trim() === '') return line;
        return ordered ? `${index + 1}. ${line}` : `- ${line}`;
      });

      const replacement: string = formattedLines.join('\n');
      const newText: string = value.substring(0, start) + replacement + value.substring(end);
      onChange(newText);
      restoreCaret(textarea, start + replacement.length);
    }
  };

  return (
    <div className="flex flex-col w-full">
      <MDXToolbar
        onBold={handleBold}
        onItalic={handleItalic}
        onUnderline={handleUnderline}
        onHeading={handleHeading}
        onList={handleList}
        onBlockquote={handleBlockquote}
        onCode={handleCode}
        onLink={handleLink}
        onImage={handleImage}
      />

      <textarea
        ref={textAreaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full p-4 rounded-b-md border border-border bg-card text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring`}
        style={{ height }}
        placeholder={placeholder}
        onSelect={handleSelectionChange}
      />

      <MediaUploader
        open={mediaUploaderOpen}
        onClose={() => setMediaUploaderOpen(false)}
        onMediaInsert={handleMediaInsert}
      />
    </div>
  );
};
