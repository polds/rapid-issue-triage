import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A picker overlay stacked above this dialog owns Escape.
        if (document.querySelector("[data-picker-open]")) return;
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  // Portal to <body>: ancestors with backdrop-filter/transform (the sticky
  // header) become containing blocks for fixed elements and trap the overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[10vh]">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] dark:bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal
        className={cn(
          "relative w-full max-w-lg rounded-xl border border-border bg-popover p-6 shadow-pop anim-pop-in",
          className,
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
