// Linear label groups hold one label per issue. When a macro or a quick edit
// would add a second, this asks the one question that resolves it — replace the
// label the issue already carries, or cancel — instead of letting the action
// fail on Linear's "labelIds not exclusive child labels".
//
// A clash the action cannot resolve on its own (a macro adding two siblings, or
// an issue that already carried two) is explained here rather than offered as a
// choice: there is no basis for picking a winner.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Tags, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeConflict } from "@/lib/labelgroups";
import type { LabelGroupConflict } from "@/lib/types";

export function LabelGroupPrompt({
  identifier,
  action,
  conflicts,
  onReplace,
  onClose,
}: {
  identifier: string;
  action: string; // what the user asked for, e.g. a macro name
  conflicts: LabelGroupConflict[];
  onReplace: () => void;
  onClose: () => void;
}) {
  const replaceRef = useRef<HTMLButtonElement>(null);
  const canReplace = conflicts.length > 0 && conflicts.every((c) => c.resolvable);

  useEffect(() => {
    if (canReplace) replaceRef.current?.focus();
  }, [canReplace]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && canReplace) {
      e.preventDefault();
      onReplace();
    }
  };

  return createPortal(
    <div data-picker-open className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[16vh]" onKeyDown={onKey}>
      <div className="fixed inset-0 bg-black/25 dark:bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover shadow-pop anim-pop-in">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Tags className="size-4 shrink-0 text-warning-foreground dark:text-warning" />
          <span className="text-sm font-medium">
            {canReplace ? "Replace a label?" : "Conflicting labels"}
          </span>
        </div>

        <div className="space-y-3 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{action}</span> on{" "}
            <span className="font-mono">{identifier}</span>
          </p>
          {conflicts.map((c) => (
            <div key={c.group} className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
              <p className="text-sm">{describeConflict(c)}</p>
              {c.resolvable && (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-muted-foreground line-through">
                    {c.existing.join(", ")}
                  </span>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-success">
                    {c.incoming.join(", ")}
                  </span>
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="quiet" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {canReplace && (
            <Button ref={replaceRef} variant="accept" size="sm" onClick={onReplace}>
              Replace
            </Button>
          )}
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          {canReplace
            ? "Replacing swaps the label on the issue, then applies the rest of the action. Esc cancels."
            : "Nothing was applied. Fix the macro, or clear the extra label in Linear, then try again."}
        </p>
      </div>
    </div>,
    document.body,
  );
}
