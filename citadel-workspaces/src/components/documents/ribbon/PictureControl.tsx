/**
 * Insert › Pictures: a file picker for a PNG or JPEG, whose bytes go to the editor (addImage,
 * which reads the type from the signature), and whose content id InsertImageFitted then places
 * at the caret, at its own size scaled down to the column.
 */
import { useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { Image } from 'lucide-react';
import type { AddedImage } from '@/lib/cdoc/editor/controller';
import type { RibbonEditor } from './editor-context';
import { describePictureFailure, PICTURE_NOT_ADDED as NOT_ADDED } from '@/lib/cdoc/pictures/picture-port';
import { PICTURE_TYPES } from './picture';
import { RibbonButton } from './RibbonButton';
import { useRibbon, type Ribbon } from './ribbon-context';

async function added(file: File, editor: RibbonEditor, ribbon: Ribbon): Promise<AddedImage> {
  const bytes: Uint8Array = await ribbon.environment.readBytes(file);
  try {
    return await editor.addImage(bytes);
  } catch (error: unknown) {
    // A refusal by the document's store is addressed to the member; the engine's decode message is
    // not, and its cause is the file.
    if (error instanceof Error && error.message.startsWith(NOT_ADDED)) throw error;
    console.warn('[PictureControl] the editor did not take', file.name, error);
    throw new Error(`${file.name} could not be read as a picture.`);
  }
}

async function insertPicture(file: File, editor: RibbonEditor, ribbon: Ribbon): Promise<void> {
  if (!PICTURE_TYPES.includes(file.type)) throw new Error(`${file.name} is not a PNG or JPEG picture.`);
  // The document's limit (its store's), asked before the file is read: a picture over it is never read or sent.
  const max: number = await editor.pictureLimit();
  if (file.size > max) throw new Error(`${file.name} is too large. ${describePictureFailure({ kind: 'tooLarge', maxBytes: max })}`);
  const image: AddedImage = await added(file, editor, ribbon);
  await editor.execute({ name: 'insertImageFitted', contentId: image.contentId });
}

/** `unavailable`: why this document takes no pictures (a chat document's peer could not see them), or null. */
export function PictureControl({ unavailable }: { readonly unavailable: string | null }): JSX.Element {
  const ribbon: Ribbon = useRibbon();
  const input: RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  const [inserting, setInserting] = useState<boolean>(false);
  return (
    <>
      <RibbonButton testId="ribbon-insert-picture" label="Picture" icon={Image} text={inserting ? 'Inserting…' : 'Picture'}
        unavailable={unavailable ?? (inserting ? 'A picture is being inserted.' : null)} aria-busy={inserting} onPress={(): void => input.current?.click()} />
      <input ref={input} type="file" accept={PICTURE_TYPES.join(',')} hidden data-testid="ribbon-picture-file" aria-label="Picture file"
        onChange={(e: ChangeEvent<HTMLInputElement>): void => {
          const file: File | undefined = e.target.files?.[0];
          e.target.value = '';
          if (file === undefined) return;
          setInserting(true);
          void ribbon.attempt('insert the picture', (editor: RibbonEditor): Promise<void> => insertPicture(file, editor, ribbon)).finally((): void => setInserting(false));
        }} />
    </>
  );
}
