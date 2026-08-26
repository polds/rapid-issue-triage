import { Dialog } from "@/components/ui/dialog";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["←", "→"], label: "Previous / next issue" },
  { keys: ["S"], label: "Skip issue" },
  { keys: ["Z"], label: "Snooze 7 days" },
  { keys: ["1", "9"], label: "Apply macro 1–9" },
  { keys: ["L"], label: "Labels picker" },
  { keys: ["E"], label: "Estimate picker" },
  { keys: ["C"], label: "Cycle picker" },
  { keys: ["P"], label: "Project picker" },
  { keys: ["A"], label: "Assignee picker" },
  { keys: ["X"], label: "Status picker" },
  { keys: ["Space"], label: "Expand full context" },
  { keys: ["U"], label: "Undo last action" },
  { keys: ["I"], label: "Enrich with AI" },
  { keys: ["O"], label: "Open in Linear" },
  { keys: ["?"], label: "Toggle this help" },
];

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="grid gap-1.5">
        {SHORTCUTS.map((s) => (
          <div
            key={s.label}
            className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent/60"
          >
            <span className="text-muted-foreground">{s.label}</span>
            <span className="flex items-center gap-1">
              {s.keys.map((k, i) => (
                <span key={k} className="flex items-center gap-1">
                  {i > 0 && <span className="text-xs text-muted-foreground">–</span>}
                  <kbd className="kbd">{k}</kbd>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
