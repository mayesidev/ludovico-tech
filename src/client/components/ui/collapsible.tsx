import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { cn } from "../../lib/utils";

export function Collapsible(props: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger(props: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  );
}

export function CollapsibleContent({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        "rounded-sm border border-border-subtle bg-canvas/35 px-4 py-3",
        className,
      )}
      {...props}
    />
  );
}
