import { Type, Code2, FileText } from 'lucide-react';
import type { MessageType } from '@/types/message-protocol';

interface TypeSelectorBarProps {
  /** The kinds this conversation can carry, in the order they are offered. */
  offered: readonly MessageType[];
  selectedType: MessageType;
  onTypeChange: (type: MessageType) => void;
}

interface TypeButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function TypeButton({ icon, label, active, onClick }: TypeButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
        transition-all duration-150 ease-in-out
        ${active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/5'
        }
        cursor-pointer
      `}
      title={label}
      // The label is hidden below `sm`, so on a phone this button has no text
      // at all -- which is also why a spec cannot find it by its words. The
      // testid is derived from the label so every type gets one for free.
      data-testid={`message-type-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function TypeSelectorBar({ offered, selectedType, onTypeChange }: TypeSelectorBarProps): JSX.Element {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-t border-surface/50 bg-background">
      <span className="text-xs text-muted-foreground mr-2 hidden sm:inline">Type:</span>
      {offered.includes('text') && <TypeButton
        icon={<Type className="h-3.5 w-3.5" />}
        label="Text"
        active={selectedType === 'text'}
        onClick={() => onTypeChange('text')}
      />}
      {offered.includes('markdown') && <TypeButton
        icon={<Code2 className="h-3.5 w-3.5" />}
        label="Markdown"
        active={selectedType === 'markdown'}
        onClick={() => onTypeChange('markdown')}
      />}
      {offered.includes('live_document') && <TypeButton
        icon={<FileText className="h-3.5 w-3.5" />}
        label="Live Doc"
        active={selectedType === 'live_document'}
        onClick={() => onTypeChange('live_document')}
      />}
    </div>
  );
}
