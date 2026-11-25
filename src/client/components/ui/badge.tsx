import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "../../lib/utils";

export function Badge({
  className,
  render,
  ...props
}: useRender.ComponentProps<"span">) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          "metadata-value inline-flex items-center border-l-2 border-highlight bg-surface-interactive px-3 py-2 text-highlight-soft",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "badge" },
  });
}
