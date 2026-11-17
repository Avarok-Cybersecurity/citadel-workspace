import { useState, useRef , type RefObject } from 'react';
import { describeFailure } from '@/lib/failure-message';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogHeader, DialogTitle, DialogDescription, Dialog } from '@/components/ui/dialog';
import { Upload, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { activateOnKey } from '@/lib/a11y';

interface MediaUploaderProps {
  open: boolean;
  onClose: () => void;
  onMediaInsert: (markdownText: string) => void;
}

export const MediaUploader: React.FC<MediaUploaderProps> = ({
  open,
  onClose,
  onMediaInsert
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [altText, setAltText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef: RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleDrag = (e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      runAsyncSetup(async () => {
        await handleFile(e.dataTransfer.files[0]);
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    e.preventDefault();
    const file: File | undefined = e.target.files?.[0];
    if (file) {
      runAsyncSetup(async () => {
        await handleFile(file);
      });
    }
  };

  const handleFile = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Unsupported file format',
        description: 'Please upload an image file (JPEG, PNG, GIF, etc.)',
        variant: 'destructive',
      });
      return;
    }

    // For larger applications, you'd upload the file to a server here
    // For now, we'll just use a data URL for demonstration
    setUploading(true);
    try {
      const reader: FileReader = new FileReader();
      reader.onload = (): void => {
        setUploadedImage(reader.result as string);
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      debugLog('MediaUploader', 'Error handling file:', error);
      toast({
        title: 'Upload failed',
        description: describeFailure(error, 'There was a problem uploading your image'),
        variant: 'destructive',
      });
      setUploading(false);
    }
  };

  const handleInsert = (): void => {
    if (!uploadedImage) return;
    
    // In a full implementation, this would be a URL to the uploaded image
    // on your server or storage service
    const mdxCode: string = `![${altText || 'Image'}](${uploadedImage})`;
    onMediaInsert(mdxCode);
    handleCancel();
  };

  const handleCancel = (): void => {
    setUploadedImage(null);
    setAltText('');
    onClose();
  };

  const handleButtonClick = (): void => {
    fileInputRef.current?.click();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-card text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Insert Media</DialogTitle>
          <DialogDescription className="text-foreground/80">
            Upload an image to embed in your content
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {!uploadedImage ? (
            <div
              className={`border-2 border-dashed rounded-lg p-6 ${
                dragActive 
                  ? 'border-primary-accent bg-primary/10' 
                  : 'border-border hover:border-primary-accent hover:bg-primary/10'
              }`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={handleButtonClick}
              role="button"
              tabIndex={0}
              onKeyDown={activateOnKey(handleButtonClick)}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handleFileChange}
              />
              <div className="flex flex-col items-center justify-center gap-2 text-center">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground/80">
                  Drag and drop your image here or click to browse
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports JPG, PNG, GIF up to 5MB
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative">
                <img 
                  src={uploadedImage} 
                  alt="Uploaded preview" 
                  className="rounded-md max-h-80 mx-auto object-contain" 
                />
                <button 
                  className="absolute top-2 right-2 rounded-full bg-background/80 p-1 hover:bg-accent"
                  aria-label="Remove uploaded image"
                  onClick={() => setUploadedImage(null)}
                >
                  <X className="h-4 w-4 text-foreground" />
                </button>
              </div>
              
              <div className="space-y-2">
                <label htmlFor="alt-text" className="text-sm font-medium text-foreground">
                  Alt Text (Accessibility)
                </label>
                <input
                  id="alt-text"
                  type="text"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  placeholder="Describe this image for screen readers"
                  className="w-full px-3 py-2 bg-card border border-border rounded-md text-foreground"
                />
              </div>
            </div>
          )}
          
          <div className="flex justify-end gap-2">
            <Button 
              variant="ghost" 
              onClick={handleCancel}
              className="text-foreground hover:bg-accent"
            >
              Cancel
            </Button>
            <Button
              onClick={handleInsert}
              disabled={!uploadedImage || uploading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {uploading ? 'Uploading...' : 'Insert Image'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
