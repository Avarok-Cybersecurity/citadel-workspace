/**
 * The Calendar's one native `<select>`: 44px tall in every engine (WebKit ignores the height and
 * min-height of a select drawn with its own appearance, so this one draws none, and its chevron),
 * with the focus ring every control has. A native select keeps the platform's own picker on a
 * phone, which a list of every time zone needs.
 */
import { forwardRef, type SelectHTMLAttributes, type ForwardRefExoticComponent, type RefAttributes, type ForwardedRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const NativeSelect: ForwardRefExoticComponent<SelectHTMLAttributes<HTMLSelectElement> & RefAttributes<HTMLSelectElement>> = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function NativeSelect({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>, ref: ForwardedRef<HTMLSelectElement>) {
  return (
    <span className={cn('relative inline-flex min-w-0', className)}>
      <select
        ref={ref}
        {...rest}
        className="h-[44px] w-full min-w-0 appearance-none rounded-md border border-input bg-background pl-3 pr-9 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </span>
  );
});
