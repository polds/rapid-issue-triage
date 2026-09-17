// Ticket search: a command-palette overlay that live-searches Linear and pulls
// the chosen ticket straight into the deck at the cursor — a way to jump to any
// issue by identifier or title without waiting for it in the queue. Opened by
// the `G` shortcut ("go to issue") or the TopBar search button.
//
// The searched ticket may already be triaged or closed; pulling is the point.
// The pull itself lives in the store (`pullIssue`), which fetches the full row
// from Linear via the server, inserts it, and selects it. This component only
// drives the search box + keyboard selection, mirroring DuplicateOfPicker.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useTriage } from "@/lib/triage-context";
import type { LinearSearchHit } from "@/lib/types";
import { cn } from "@/lib/utils";

// A bare identifier (CORE-123) is pulled directly on Enter even with no search
// hits, so you can jump to a ticket the title search wouldn't surface.
const IDENTIFIER_RE = /^[A-Za-z]+-\d+$/;

export function TicketSearch({ onClose }: { onClose: () => void }) {
  const { pullIssue } = useTriage();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LinearSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);

  // The event that changes the query drives the spinner and the cleared list,
  // leaving the effect below as purely the debounced call out to Linear.
  const changeQuery = (v: string) => {
    setQuery(v);
    setCursor(0);
    if (v.trim()) setLoading(true);
    else setHits([]);
  };

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const mySeq = ++seq.current;
    const t = setTimeout(() => {
      void api
        .linearSearch(q)
        .then((r) => {
          if (seq.current === mySeq) {
            setHits(r);
            setCursor(0);
          }
        })
        .finally(() => seq.current === mySeq && setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const pull = async (idOrIdentifier: string) => {
    if (pulling) return;
    setPulling(true);
    const id = await pullIssue(idOrIdentifier);
    setPulling(false);
    if (id) onClose(); // failures raise their own toast; keep the palette open
  };

  const trimmed = query.trim();
  const canPullRaw = IDENTIFIER_RE.test(trimmed);

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
      if (h) void pull(h.id);
      else if (canPullRaw) void pull(trimmed);
    }
  };

  return createPortal(
    <div data-picker-open className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[16vh]" onKeyDown={onKey}>
      <div className="fixed inset-0 bg-black/25 dark:bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover shadow-pop anim-pop-in">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">Go to issue</span>
          <span className="ml-auto text-[11px] text-muted-foreground">pulls into the deck</span>
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          placeholder="Search Linear by identifier or title…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="max-h-72 min-h-[4.5rem] overflow-y-auto p-1.5">
          {!trimmed && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Type an issue identifier (like <span className="font-mono text-foreground">CORE-123</span>) or part of a
              title to search.
            </p>
          )}
          {trimmed && (loading || pulling) && (
            <p className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {pulling ? "Pulling ticket…" : "Searching Linear…"}
            </p>
          )}
          {!loading && !pulling && trimmed && hits.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {canPullRaw ? (
                <>
                  No title match. Press <kbd className="kbd h-5">Enter</kbd> to pull{" "}
                  <span className="font-mono text-foreground">{trimmed.toUpperCase()}</span> directly.
                </>
              ) : (
                "No match in Linear."
              )}
            </div>
          )}
          {!loading &&
            hits.map((h, i) => (
              <button
                key={h.id}
                onClick={() => void pull(h.id)}
                onMouseMove={() => setCursor(i)}
                disabled={pulling}
                className={cn(
                  "flex w-full cursor-pointer items-baseline gap-2 rounded-lg px-3 py-2 text-left text-sm disabled:opacity-60",
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
          Loads any ticket — triaged or closed — as the next card. ↑↓ to move · Enter to pull · Esc cancels.
        </p>
      </div>
    </div>,
    document.body,
  );
}
