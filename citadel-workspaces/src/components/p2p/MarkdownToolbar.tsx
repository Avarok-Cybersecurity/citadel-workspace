import { motion, AnimatePresence } from 'framer-motion';
import {
  Bold,
  Italic,
  Strikethrough,
  Superscript,
  Subscript,
  List,
  ListOrdered,
  Link,
  Table,
  Code,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Eye,
  Edit,
} from 'lucide-react';
import { useCallback } from 'react';

interface MarkdownToolbarProps {
  visible: boolean;
  onFormat: (format: string, prefix: string, suffix: string) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement>;
  showPreview?: boolean;
  onTogglePreview?: () => void;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}

function ToolbarButton({ icon, onClick, title, active = false }: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      /* Bold, Italic, Quote, Code and Preview are toggles whose on-state was a
         background colour and nothing else. A screen reader could not tell
         whether Bold was on, and heard nothing change when it was pressed. */
      aria-pressed={active}
      aria-label={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-foreground/10 text-muted-foreground hover:text-foreground'
      }`}
      title={title}
    >
      {icon}
    </button>
  );
}

function Separator(): JSX.Element {
  return <div className="w-px h-5 bg-border mx-1" />;
}

export function MarkdownToolbar({ visible, onFormat, showPreview, onTogglePreview }: MarkdownToolbarProps): JSX.Element {
  const formatHandlers: { bold: () => void; italic: () => void; strike: () => void; superscript: () => void; subscript: () => void; h1: () => void; h2: () => void; h3: () => void; bullet: () => void; numbered: () => void; link: () => void; table: () => void; code: () => void; quote: () => void; } = {
    bold: (): void => onFormat('bold', '**', '**'),
    italic: (): void => onFormat('italic', '*', '*'),
    strike: (): void => onFormat('strike', '~~', '~~'),
    superscript: (): void => onFormat('superscript', '<sup>', '</sup>'),
    subscript: (): void => onFormat('subscript', '<sub>', '</sub>'),
    h1: (): void => onFormat('h1', '# ', ''),
    h2: (): void => onFormat('h2', '## ', ''),
    h3: (): void => onFormat('h3', '### ', ''),
    bullet: (): void => onFormat('bullet', '- ', ''),
    numbered: (): void => onFormat('numbered', '1. ', ''),
    link: (): void => onFormat('link', '[', '](url)'),
    table: (): void => onFormat('table', '\n| Header | Header |\n|--------|--------|\n| Cell | Cell |\n', ''),
    code: (): void => onFormat('code', '```\n', '\n```'),
    quote: (): void => onFormat('quote', '> ', ''),
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="overflow-hidden border-t border-surface/50 bg-background"
        >
          <div className="flex flex-wrap items-center gap-0.5 p-2">
            {/* Text formatting */}
            <ToolbarButton
              icon={<Bold className="h-4 w-4" />}
              onClick={formatHandlers.bold}
              title="Bold (Ctrl+B)"
            />
            <ToolbarButton
              icon={<Italic className="h-4 w-4" />}
              onClick={formatHandlers.italic}
              title="Italic (Ctrl+I)"
            />
            <ToolbarButton
              icon={<Strikethrough className="h-4 w-4" />}
              onClick={formatHandlers.strike}
              title="Strikethrough"
            />
            <ToolbarButton
              icon={<Superscript className="h-4 w-4" />}
              onClick={formatHandlers.superscript}
              title="Superscript"
            />
            <ToolbarButton
              icon={<Subscript className="h-4 w-4" />}
              onClick={formatHandlers.subscript}
              title="Subscript"
            />

            <Separator />

            {/* Headings */}
            <ToolbarButton
              icon={<Heading1 className="h-4 w-4" />}
              onClick={formatHandlers.h1}
              title="Heading 1"
            />
            <ToolbarButton
              icon={<Heading2 className="h-4 w-4" />}
              onClick={formatHandlers.h2}
              title="Heading 2"
            />
            <ToolbarButton
              icon={<Heading3 className="h-4 w-4" />}
              onClick={formatHandlers.h3}
              title="Heading 3"
            />

            <Separator />

            {/* Lists */}
            <ToolbarButton
              icon={<List className="h-4 w-4" />}
              onClick={formatHandlers.bullet}
              title="Bullet List"
            />
            <ToolbarButton
              icon={<ListOrdered className="h-4 w-4" />}
              onClick={formatHandlers.numbered}
              title="Numbered List"
            />

            <Separator />

            {/* Other */}
            <ToolbarButton
              icon={<Link className="h-4 w-4" />}
              onClick={formatHandlers.link}
              title="Insert Link"
            />
            <ToolbarButton
              icon={<Table className="h-4 w-4" />}
              onClick={formatHandlers.table}
              title="Insert Table"
            />
            <ToolbarButton
              icon={<Code className="h-4 w-4" />}
              onClick={formatHandlers.code}
              title="Code Block"
            />
            <ToolbarButton
              icon={<Quote className="h-4 w-4" />}
              onClick={formatHandlers.quote}
              title="Blockquote"
            />

            {/* Preview toggle - shown when callback provided */}
            {onTogglePreview && (
              <>
                <Separator />
                <ToolbarButton
                  icon={showPreview ? <Edit className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  onClick={onTogglePreview}
                  title={showPreview ? "Edit" : "Preview"}
                  active={showPreview}
                />
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Hook for handling markdown formatting in a textarea/input
 */
export function useMarkdownFormat(
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement>,
  setValue: (value: string) => void,
  getValue: () => string
): (format: string, prefix: string, suffix: string) => void {
  const handleFormat: (format: string, prefix: string, suffix: string) => void = useCallback((format: string, prefix: string, suffix: string): void => {
    const input: HTMLInputElement | HTMLTextAreaElement | null = inputRef.current;
    if (!input) return;

    const start: number = input.selectionStart || 0;
    const end: number = input.selectionEnd || 0;
    const text: string = getValue();
    const selectedText: string = text.substring(start, end);

    // Insert format around selection or at cursor
    const newText: string = text.substring(0, start) + prefix + selectedText + suffix + text.substring(end);
    setValue(newText);

    // Restore cursor position after the inserted text
    setTimeout(() => {
      input.focus();
      const newCursorPos: number = selectedText
        ? start + prefix.length + selectedText.length + suffix.length
        : start + prefix.length;
      input.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [inputRef, setValue, getValue]);

  return handleFormat;
}
