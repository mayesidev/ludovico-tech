import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Check } from "lucide-react";
import { Input } from "./input";

export function Combobox<Value>(props: ComboboxPrimitive.Root.Props<Value>) {
  return <ComboboxPrimitive.Root {...props} />;
}

export function ComboboxInput(props: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      render={<Input adornment="end" />}
      {...props}
    />
  );
}

export function ComboboxContent(props: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        align="start"
        className="z-50"
        sideOffset={6}
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className="surface-elevated w-(--anchor-width) max-w-(--available-width) rounded-sm border border-border-subtle shadow-xl shadow-black/40"
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

export function ComboboxList(props: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className="max-h-[min(--spacing(60),var(--available-height))] overflow-y-auto overscroll-contain p-1 data-empty:p-0"
      {...props}
    />
  );
}

export function ComboboxItem({
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className="flex min-h-10 cursor-default items-center justify-between gap-2 rounded-xs px-2 text-sm text-text-primary outline-none select-none data-highlighted:bg-surface-interactive data-highlighted:text-highlight-soft"
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator data-slot="combobox-item-indicator">
        <Check aria-hidden="true" size={16} />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}
