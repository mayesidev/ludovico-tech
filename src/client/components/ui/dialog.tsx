import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "../../lib/utils";

export function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />;
}

export function DialogContent({
  className,
  ...props
}: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-overlay"
        className="fixed inset-0 z-40 bg-black/75"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "surface-elevated fixed inset-0 z-40 m-auto h-fit max-h-[calc(100dvh-2.5rem)] w-[calc(100%-2.5rem)] max-w-lg overflow-y-auto rounded-sm border p-6 shadow-2xl shadow-black/50 outline-none sm:p-8",
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

export function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-3xl font-medium tracking-tight text-text-primary",
        className,
      )}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm leading-6 text-text-muted", className)}
      {...props}
    />
  );
}
