/**
 * Image processing utilities for avatar uploads
 * Handles resizing and WebP conversion using Canvas API
 */

/**
 * Processes an image file for avatar use:
 * - Resizes to fit within maxDimension (preserving aspect ratio)
 * - Converts to WebP format
 * - Returns base64-encoded string
 *
 * @param file - The image file to process
 * @param maxDimension - Maximum width/height (default 256)
 * @param quality - WebP quality 0-1 (default 0.85)
 * @returns Promise resolving to base64-encoded WebP string
 */
export async function processAvatarImage(
  file: File,
  maxDimension: number = 256,
  quality: number = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      reject(new Error('File must be an image'));
      return;
    }

    // Validate file size (max 5MB)
    const maxSize: number = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      reject(new Error('Image must be smaller than 5MB'));
      return;
    }

    const img: HTMLImageElement = new Image();
    const reader: FileReader = new FileReader();

    reader.onload = (e): void => {
      img.onload = (): void => {
        try {
          // Calculate new dimensions while maintaining aspect ratio
          let width: number = img.width;
          let height: number = img.height;

          if (width > height) {
            if (width > maxDimension) {
              height = (height * maxDimension) / width;
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = (width * maxDimension) / height;
              height = maxDimension;
            }
          }

          // Create canvas and draw resized image
          const canvas: HTMLCanvasElement = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx: ReturnType<typeof canvas.getContext> = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          // Use high-quality image smoothing
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Draw the image
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to WebP (or PNG fallback if WebP not supported)
          let dataUrl: string;
          if (canvas.toDataURL('image/webp').startsWith('data:image/webp')) {
            dataUrl = canvas.toDataURL('image/webp', quality);
          } else {
            // Fallback to PNG if WebP not supported
            dataUrl = canvas.toDataURL('image/png');
          }

          // Extract base64 portion (remove data URL prefix)
          const base64: string = dataUrl.split(',')[1];
          resolve(base64);
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = (): void => {
        reject(new Error('Failed to load image'));
      };

      img.src = e.target?.result as string;
    };

    reader.onerror = (): void => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Creates a data URL from base64 avatar data
 * @param base64 - Base64-encoded image data
 * @returns Data URL suitable for img src
 */
export function avatarToDataUrl(base64: string): string {
  // A stored avatar can already be a data URL (avatar-url.ts); prefixing it again breaks the image.
  if (base64.startsWith('data:')) return base64;
  // Detect format from base64 header if possible, default to webp
  if (base64.startsWith('iVBOR')) {
    return `data:image/png;base64,${base64}`;
  }
  return `data:image/webp;base64,${base64}`;
}

/**
 * Validates if a file is a valid image for avatar use
 * @param file - File to validate
 * @returns Object with isValid boolean and optional error message
 */
export function validateAvatarFile(file: File): { isValid: boolean; error?: string } {
  const validTypes: string[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const maxSize: number = 5 * 1024 * 1024; // 5MB

  if (!validTypes.includes(file.type)) {
    return {
      isValid: false,
      error: 'Please upload a JPEG, PNG, GIF, or WebP image',
    };
  }

  if (file.size > maxSize) {
    return {
      isValid: false,
      error: 'Image must be smaller than 5MB',
    };
  }

  return { isValid: true };
}
