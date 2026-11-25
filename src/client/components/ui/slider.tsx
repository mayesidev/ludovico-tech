import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "../../lib/utils";

export function Slider({
  children,
  className,
  ...props
}: Omit<SliderPrimitive.Root.Props<number>, "orientation">) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("w-full", className)}
      {...props}
    >
      {children}
      <SliderPrimitive.Control className="relative mx-2 mt-2 flex h-8 cursor-pointer touch-none items-center select-none data-disabled:cursor-not-allowed data-disabled:opacity-50">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-1 w-full rounded-full bg-border-subtle"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="rounded-full bg-highlight"
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className="relative size-4 rounded-full bg-highlight has-focus-visible:ring-2 has-focus-visible:ring-focus has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-canvas"
          data-slot="slider-thumb"
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export function SliderLabel(props: SliderPrimitive.Label.Props) {
  return (
    <SliderPrimitive.Label
      data-slot="slider-label"
      className="ui-label text-text-secondary"
      {...props}
    />
  );
}
