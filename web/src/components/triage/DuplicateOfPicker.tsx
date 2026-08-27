// "Duplicate of…" picker: Linear requires a duplicate relation before an
// issue can enter a duplicate-type state. Live-searches Linear (canonical
// issues are usually already triaged, so the local index won't have them)
// and surfaces the AI report's related issues as one-click suggestions.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CopyX, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DeepReport, LinearSearchHit } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DuplicateOfPicker({
  identifier,
  report,
  onPick,
  onClose,
}: {
  identifier: string; // the issue being marked duplicate
  report?: DeepReport | null;
  onPick: (canonicalId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LinearSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const mySeq = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .linearSearch(q)
        .then((r) => {
          if (seq.current === mySeq) {
            setHits(r.filter((h) => h.identifier !== identifier));
            setCursor(0);
          }
        })
        .finally(() => seq.current === mySeq && setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query, identifier]);

  const suggestions = (report?.relatedIssues ?? []).filter((ri) => ri.identifier !== identifier);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const h = hits[cursor];
      if (h) onPick(h.id);
    }
  };

  return createPortal(
    <div data-picker-open className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[16vh]" onKeyDown={onKey}>
      <div className="fixed inset-0 bg-black/25 dark:bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover shadow-pop anim-pop-in">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <CopyX className="size-4 shrink-0 text-warning-foreground dark:text-warning" />
          <span className="text-sm font-medium">
            <span className="font-mono">{identifier}</span> is a duplicate of…
          </span>
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Linear by identifier or title…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        {suggestions.length > 0 && !query.trim() && (
          <div className="border-b border-border px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              From the AI report
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestions.map((ri) => (
                <button
                  key={ri.identifier}
                  onClick={() => setQuery(ri.identifier)}
                  className="cursor-pointer rounded-full border border-border bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:bg-accent"
                  title={ri.title}
                >
                  {ri.identifier} · {ri.state}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="max-h-72 overflow-y-auto p-1.5">
          {loading && (
            <p className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Searching Linear…
            </p>
          )}
          {!loading && query.trim() && hits.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">No match in Linear.</p>
          )}
          {!loading &&
            hits.map((h, i) => (
              <button
                key={h.id}
                onClick={() => onPick(h.id)}
                onMouseMove={() => setCursor(i)}
                className={cn(
                  "flex w-full cursor-pointer items-baseline gap-2 rounded-lg px-3 py-2 text-left text-sm",
                  i === cursor && "bg-accent text-accent-foreground",
                )}
              >
                <span className="shrink-0 font-mono text-xs font-semibold">{h.identifier}</span>
                <span className="min-w-0 flex-1 truncate">{h.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{h.state}</span>
              </button>
            ))}
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Creates the duplicate relation, then applies the status. Esc cancels.
        </p>
      </div>
    </div>,
    document.body,
  );
}
