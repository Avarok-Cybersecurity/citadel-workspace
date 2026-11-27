/** A report that went: its id, to hand to an admin or quote to Avarok. */
import { Button } from '@/components/ui/button';

export function ReportSent({ id, onClose }: { readonly id: string; readonly onClose: () => void }): JSX.Element {
  return (
    <div role="status" className="flex flex-col gap-3 text-sm" data-testid="bug-report-sent">
      <p className="text-foreground">Thank you. Your report was sent.</p>
      <p className="text-foreground">Report id: <span className="font-mono" data-testid="bug-report-id">{id}</span></p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-[44px]" onClick={(): void => { void navigator.clipboard.writeText(id); }} data-testid="bug-report-copy-id">Copy id</Button>
        <Button className="min-h-[44px]" onClick={onClose} data-testid="bug-report-close">Close</Button>
      </div>
    </div>
  );
}
