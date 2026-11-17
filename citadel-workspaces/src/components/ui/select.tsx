
import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select: typeof SelectPrimitive.Root = SelectPrimitive.Root

const SelectGroup: typeof SelectPrimitive.Group = SelectPrimitive.Group

const SelectValue: typeof SelectPrimitive.Value = SelectPrimitive.Value

/**
 * The trigger takes its name from the `<label for>` that points at it.
 *
 * Radix renders this as a `<button role="combobox">`, and `htmlFor` labels only
 * labelable elements -- so `<Label htmlFor="who-can-message-you">` beside
 * `<SelectTrigger id="who-can-message-you">` names nothing. The accessible name
 * then falls back to the trigger's CONTENTS, which is the current value.
 *
 * Measured on Settings: the privacy select announced itself as "Connections",
 * and the appearance one as "Default". A screen-reader user hears the value
 * instead of what it controls -- and the name changes when the value does, so
 * there is nothing stable to refer to. axe passes it, because a name computed
 * from contents is still a name.
 *
 * Same defect as the Font Size slider in round 210, in a different primitive.
 * Fixed here rather than at twelve call sites, and done by LOOKING UP the
 * existing label rather than requiring a new prop: the markup is already
 * correct and conventional, it is only the association that HTML will not make.
 */
function useLabelledBy(id: string | undefined): string | undefined {
  const [labelId, setLabelId] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (!id) return;
    const label: HTMLElement | null = document.querySelector<HTMLElement>(`label[for="${CSS.escape(id)}"]`);
    if (!label) return;
    if (!label.id) label.id = `${id}-label`;
    setLabelId(label.id);
  }, [id]);
  return labelId;
}

const SelectTrigger: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & React.RefAttributes<React.ElementRef<typeof SelectPrimitive.Trigger>>> = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => {
  const labelledBy: string | undefined = useLabelledBy(props.id);
  return (
  <SelectPrimitive.Trigger
    ref={ref}
    // An explicit name on the call site wins; this only fills the gap.
    aria-labelledby={props['aria-labelledby'] ?? (props['aria-label'] ? undefined : labelledBy)}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-control-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
  );
})
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton> & React.RefAttributes<React.ElementRef<typeof SelectPrimitive.ScrollUpButton>>> = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton> & React.RefAttributes<React.ElementRef<typeof SelectPrimitive.ScrollDownButton>>> = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & React.RefAttributes<React.ElementRef<typeof SelectPrimitive.Content>>> = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label> & React.RefAttributes<React.ElementRef<typeof SelectPrimitive.Label>>> = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & React.RefAttributes<React.ElementRef<typeof SelectPrimitive.Item>>> = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator> & React.RefAttributes<React.ElementRef<typeof SelectPrimitive.Separator>>> = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
