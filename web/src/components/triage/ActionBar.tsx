import { Clock3, SkipForward } from "lucide-react";
import { useTriage } from "@/lib/triage-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Macro } from "@/lib/types";

const OUTCOME_VARIANT: Record<Macro["outcome"], "accept" | "cancel" | "defer" | "neutral"> = {
  accepted: "accept",
  done: "accept",
  cancelled: "cancel",
  custom: "neutral",
};

export function ActionBar({ vertical = false }: { vertical?: boolean }) {
  const { macros, applyMacro, skip, snooze, busy, current } = useTriage();
  const disabled = busy || !current || current.status !== "pending";
  const btn = vertical ? "w-full justify-between gap-2" : "gap-2";

  return (
    <div className={cn("gap-2", vertical ? "flex flex-col" : "flex flex-wrap items-center justify-center")}>
      <Button variant="neutral" onClick={skip} disabled={disabled} className={btn}>
        <span className="inline-flex items-center gap-2">
          <SkipForward className="size-4" /> Skip
        </span>
        <kbd className="kbd h-5">S</kbd>
      </Button>
      <Button variant="defer" onClick={snooze} disabled={disabled} className={btn}>
        <span className="inline-flex items-center gap-2">
          <Clock3 className="size-4" /> Snooze
        </span>
        <kbd className="kbd h-5">Z</kbd>
      </Button>
      {!vertical && <span className="mx-1 hidden h-6 w-px bg-border sm:block" />}
      {vertical && macros.length > 0 && <span className="my-0.5 h-px w-full bg-border" />}
      {macros.slice(0, 9).map((m, i) => (
        <Button
          key={m.id}
          variant={OUTCOME_VARIANT[m.outcome] ?? "neutral"}
          onClick={() => applyMacro(m)}
          disabled={disabled}
          className={btn}
          title={m.name}
        >
          <span className={cn("truncate", vertical ? "min-w-0 text-left" : "max-w-[240px]")}>{m.name}</span>
          <kbd className="kbd h-5 shrink-0">{i + 1}</kbd>
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
