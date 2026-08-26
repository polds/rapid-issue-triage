import { AlertTriangle, Minus, SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import { cn } from "@/lib/utils";

// Linear priorities: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
const META: Record<number, { label: string; tone: string; icon: typeof Minus }> = {
  0: { label: "No priority", tone: "text-muted-foreground", icon: Minus },
  1: { label: "Urgent", tone: "text-prio-urgent", icon: AlertTriangle },
  2: { label: "High", tone: "text-prio-high", icon: SignalHigh },
  3: { label: "Medium", tone: "text-prio-medium", icon: SignalMedium },
  4: { label: "Low", tone: "text-prio-low", icon: SignalLow },
};

export function PriorityIcon({ priority, className }: { priority: number; className?: string }) {
  const m = META[priority] ?? META[0];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", m.tone, className)} title={m.label}>
      <Icon className="size-3.5" />
      {m.label}
    </span>
  );
}
