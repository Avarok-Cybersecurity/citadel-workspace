import { Upload, FolderOpen, FileImage, FileText, FileVideo, FileAudio, File, X } from 'lucide-react';
import { activateOnKey } from '@/lib/a11y';

function getFileIcon(mimeType: string): JSX.Element {
  if (mimeType.startsWith('image/')) return <FileImage className="h-8 w-8 text-primary-accent" />;
  if (mimeType.startsWith('video/')) return <FileVideo className="h-8 w-8 text-primary-accent" />;
  if (mimeType.startsWith('audio/')) return <FileAudio className="h-8 w-8 text-success-emphasis" />;
  if (mimeType.startsWith('text/') || mimeType.includes('pdf')) return <FileText className="h-8 w-8 text-warning-emphasis" />;
  return <File className="h-8 w-8 text-muted-foreground" />;
}

interface FileDropZoneProps {
  selectedFile: File | null;
  previewUrl: string | null;
  isDragging: boolean;
  isSending: boolean;
  isPickingFile: boolean;
  /**
   * Whether the native file picker can be used: `false` once it has refused,
   * `null` while nothing is known.
   *
   * Never `true`, and the type says so. Availability is only ever learned by
   * TRYING -- the picker reports "native-dialogs feature is disabled" or "File
   * picker not available" when it cannot run -- so there is no moment at which
   * the app learns it works, only moments at which it learns it does not.
   *
   * Readers must therefore ask `!== false`, which is what they do: an unknown
   * picker is offered, because the only way to find out is to offer it. Written
   * as `=== true` the control would never render at all, and that is a live
   * hazard rather than a hypothetical -- this codebase has shipped both halves of
   * that mistake before.
   */
  nativePickerAvailable: false | null;
  /** Null until the agent has said what it takes. */
  maxFileSizeBytes: number | null;
  formatBytes: (bytes: number) => string;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onBrowseClick: () => void;
  onNativePickerClick: () => void;
  onRemoveFile: () => void;
}

export function FileDropZone({
  selectedFile,
  previewUrl,
  isDragging,
  isSending,
  isPickingFile,
  nativePickerAvailable,
  maxFileSizeBytes,
  formatBytes,
  onDrop,
  onDragOver,
  onDragLeave,
  onBrowseClick,
  onNativePickerClick,
  onRemoveFile,
}: FileDropZoneProps): JSX.Element {
  if (selectedFile) {
    return (
      <div className="bg-surface rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={selectedFile.name}
                className="h-16 w-16 object-cover rounded-lg"
              />
            ) : (
              <div className="h-16 w-16 flex items-center justify-center bg-background rounded-lg">
                {getFileIcon(selectedFile.type)}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{selectedFile.name}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatBytes(selectedFile.size)} • {selectedFile.type || 'Unknown type'}
            </p>
          </div>
          <button
            aria-label="Remove attached file"
            onClick={onRemoveFile}
            className="p-1 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            disabled={isSending}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {nativePickerAvailable !== false && (
        <button
          onClick={onNativePickerClick}
          disabled={isPickingFile || isSending}
          className="w-full flex items-center gap-3 p-4 rounded-lg border border-primary bg-primary/10 hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="p-2 rounded-lg bg-primary/20">
            <FolderOpen className="h-5 w-5 text-primary-accent" />
          </div>
          <div className="flex-1 text-left">
            <span className="font-medium text-foreground">
              {isPickingFile ? 'Opening file picker...' : 'Browse Files'}
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Opens your computer’s file picker; your agent streams the file to them
            </p>
          </div>
        </button>
      )}

      {nativePickerAvailable !== false && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-surface" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-surface" />
        </div>
      )}

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onBrowseClick}
        role="button"
        tabIndex={0}
        onKeyDown={activateOnKey(onBrowseClick)}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-primary-accent bg-primary-accent/10'
            : 'border-surface hover:border-primary hover:bg-surface'
        }`}
      >
        <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-foreground/80">
          Drop file here or <span className="text-primary-accent">browse</span>
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {maxFileSizeBytes === null ? 'Checking how large a file your agent takes…' : `Maximum file size: ${formatBytes(maxFileSizeBytes)}`}
        </p>
      </div>
    </div>
  );
}
