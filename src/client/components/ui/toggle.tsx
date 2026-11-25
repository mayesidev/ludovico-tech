import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";

export function Toggle(props: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className="flex items-center gap-3 rounded-sm border border-border-subtle bg-canvas/25 p-3 text-left transition outline-none hover:border-highlight/45 focus-visible:ring-2 focus-visible:ring-focus aria-pressed:border-highlight aria-pressed:bg-action/20"
      {...props}
    />
  );
}
