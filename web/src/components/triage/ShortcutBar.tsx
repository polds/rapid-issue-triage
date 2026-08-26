import { HelpCircle } from "lucide-react";

const ITEMS: [string, string][] = [
  ["←/→", "prev/next"],
  ["S", "skip"],
  ["Z", "snooze"],
  ["1–9", "macros"],
  ["L", "labels"],
  ["E", "estimate"],
  ["C", "cycle"],
  ["P", "project"],
  ["A", "assign"],
  ["X", "status"],
  ["Space", "context"],
  ["U", "undo"],
];

export function ShortcutBar({ onHelp }: { onHelp: () => void }) {
  return (
    <footer className="sticky bottom-0 z-20 border-t border-border/70 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-5 py-2.5">
        {ITEMS.map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <kbd className="kbd">{k}</kbd>
            {label}
          </span>
        ))}
        <button
          onClick={onHelp}
          className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
        >
          <HelpCircle className="size-3.5" />
          <kbd className="kbd">?</kbd> help
        </button>
      </div>
    </footer>
  );
}
