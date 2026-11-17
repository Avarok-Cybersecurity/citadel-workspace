/**
 * VFSRenameInput Component
 *
 * Inline input for renaming files and folders in the file manager.
 * Renders in place of the item name when in rename mode.
 */

import { useState, useRef, useEffect, useCallback , type RefObject , type ChangeEvent } from 'react';
import { Input } from '@/components/ui/input';
import { isEnterCommit } from '@/lib/keyboard-commit';
import { entryNameError } from './vfs-content-helpers';

interface VFSRenameInputProps {
  currentName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
  isDirectory?: boolean;
}

export function VFSRenameInput({
  currentName,
  onConfirm,
  onCancel,
  isDirectory = false,
}: VFSRenameInputProps): JSX.Element {
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const inputRef: RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (!isDirectory && currentName.includes('.')) {
        const dotIndex: number = currentName.lastIndexOf('.');
        inputRef.current.setSelectionRange(0, dotIndex);
      } else {
        inputRef.current.select();
      }
    }
  }, [currentName, isDirectory]);

  const validate: (name: string) => string | null = entryNameError;

  const handleConfirm: () => void = useCallback((): void => {
    const trimmed: string = value.trim();
    const validationError: string | null = validate(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (trimmed === currentName) {
      onCancel();
      return;
    }
    onConfirm(trimmed);
  }, [value, currentName, validate, onConfirm, onCancel]);

  const handleKeyDown: (e: React.KeyboardEvent) => void = useCallback((e: React.KeyboardEvent): void => {
    if (isEnterCommit(e)) {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
    e.stopPropagation();
  }, [handleConfirm, onCancel]);

  const handleBlur: () => void = useCallback((): void => {
    handleConfirm();
  }, [handleConfirm]);

  const handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    setValue(e.target.value);
    setError(null);
  }, []);

  return (
    <div className="flex flex-col">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={`h-6 px-1 py-0 text-xs bg-surface border ${
          error ? 'border-destructive' : 'border-primary-accent'
        } text-foreground focus:ring-1 focus:ring-ring`}
        onClick={(e) => e.stopPropagation()}
      />
      {error && (
        <span className="text-xs text-destructive-emphasis mt-0.5">{error}</span>
      )}
    </div>
  );
}
