/**
 * A file Citadel Docs does not show, said under the file's name, with downloading the original
 * as the way on: the one refusal screen for every reason (a kind Docs does not read, macros,
 * bytes that could not be read), wherever the refusal is decided.
 */
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** The file a document was opened from, and how to download it unchanged. */
export interface OriginalFile {
  readonly name: string;
  readonly download: () => void;
}

interface NotOpenedProps {
  readonly original: OriginalFile;
  readonly why: string;
  readonly testId: string;
}

export function NotOpened({ original, why, testId }: NotOpenedProps): JSX.Element {
  return (
    <div role="alert" data-testid={testId} className="flex max-w-[640px] flex-col items-start gap-[12px] p-[24px] text-sm text-foreground">
      <h2 className="break-words text-base font-semibold">{original.name}</h2>
      <p>{why}</p>
      <p>You can still download the file and open it in another app.</p>
      <Button className="h-[44px]" onClick={original.download}>
        <Download className="mr-[8px] h-[16px] w-[16px]" aria-hidden="true" />Download {original.name}
      </Button>
    </div>
  );
}
