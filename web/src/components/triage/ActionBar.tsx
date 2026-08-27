import { Clock3, SkipForward } from "lucide-react";
import { useTriage } from "@/lib/store";
import { Button } from "@/components/ui/button";
import type { Macro } from "@/lib/types";

const OUTCOME_VARIANT: Record<Macro["outcome"], "accept" | "cancel" | "defer" | "neutral"> = {
  accepted: "accept",
  done: "accept",
  cancelled: "cancel",
  custom: "neutral",
};

export function ActionBar() {
  const { macros, applyMacro, skip, snooze, busy, current } = useTriage();
  const disabled = busy || !current || current.status !== "pending";

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button variant="neutral" onClick={skip} disabled={disabled} className="gap-2">
        <SkipForward /> Skip
        <kbd className="kbd h-5">S</kbd>
      </Button>
      <Button variant="defer" onClick={snooze} disabled={disabled} className="gap-2">
        <Clock3 /> Snooze
        <kbd className="kbd h-5">Z</kbd>
      </Button>
      <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
      {macros.slice(0, 9).map((m, i) => (
        <Button
          key={m.id}
          variant={OUTCOME_VARIANT[m.outcome] ?? "neutral"}
          onClick={() => applyMacro(m)}
          disabled={disabled}
          className="gap-2"
          title={m.name}
        >
          <span className="max-w-[240px] truncate">{m.name}</span>
          <kbd className="kbd h-5">{i + 1}</kbd>
        </Button>
      ))}
      {macros.length === 0 && (
        <span className="text-xs text-muted-foreground">
          No macros yet — create one on the Macros page.
        </span>
      )}
    </div>
  );
}
