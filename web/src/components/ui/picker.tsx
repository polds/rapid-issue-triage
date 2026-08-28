// Keyboard-first fuzzy picker popover: input on top, arrow-navigable list,
// Enter selects, Escape closes. The heart of fast quick-edits.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PickerOption {
  id: string;
  label: string;
  hint?: string;
  color?: string;
  selected?: boolean;
  icon?: ReactNode;
}

export function Picker({
  title,
  options,
  onPick,
  onClose,
  multi = false,
}: {
  title: string;
  options: PickerOption[];
  onPick: (id: string) => void;
  onClose: () => void;
  multi?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // Simple subsequence fuzzy match, ranked by index of first hit.
    return options
      .map((o) => {
        const l = o.label.toLowerCase();
        let qi = 0;
        let first = -1;
        for (let i = 0; i < l.length && qi < q.length; i++) {
          if (l[i] === q[qi]) {
            if (first < 0) first = i;
            qi++;
          }
        }
        return qi === q.length ? { o, rank: l.startsWith(q) ? -1 : first } : null;
      })
      .filter((x): x is { o: PickerOption; rank: number } => x !== null)
      .sort((a, b) => a.rank - b.rank)
      .map((x) => x.o);
  }, [options, query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[cursor];
      if (opt) {
        onPick(opt.id);
        if (!multi) onClose();
      }
    }
  };

  return createPortal(
    <div data-picker-open className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[16vh]" onKeyDown={onKey}>
      <div className="fixed inset-0 bg-black/25 dark:bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-xl border border-border bg-popover shadow-pop anim-pop-in">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            // Typing re-ranks the list, so the highlight goes back to the top.
            // Done here rather than in an effect: same render, no extra pass.
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder={`Search ${title.toLowerCase()}…`}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div ref={listRef} className="max-h-72 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No match.</p>
          )}
          {filtered.map((o, i) => (
            <button
              key={o.id}
              data-idx={i}
              onClick={() => {
                onPick(o.id);
                if (!multi) onClose();
              }}
              onMouseMove={() => setCursor(i)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                i === cursor && "bg-accent text-accent-foreground",
              )}
            >
              {o.color && (
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.color }} />
              )}
              {o.icon}
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && <span className="text-[11px] text-muted-foreground">{o.hint}</span>}
              {o.selected && <Check className="size-4 shrink-0 text-primary" />}
            </button>
          ))}
        </div>
        {multi && (
          <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            Enter toggles · Esc closes
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
