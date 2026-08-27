// Bell dropdown tracking background enrichments. Clicking an entry jumps
// back to that card (pulling it into the deck if it paged out).
import { useEffect, useRef, useState } from "react";
import { Bell, Check, Loader2, TriangleAlert, X } from "lucide-react";
import { useTriage } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";

const VERDICT_LABEL: Record<string, string> = {
  actionable: "Actionable",
  likely_obsolete: "Likely obsolete",
  possibly_done: "Possibly done",
  needs_info: "Needs info",
  duplicate_suspect: "Duplicate?",
};

export function NotificationBell({ navigate }: { navigate: (p: string) => void }) {
  const { notices, markNoticesRead, clearDoneNotices, focusIssue } = useTriage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const unread = notices.filter((n) => !n.read && n.status !== "running").length;
  const running = notices.filter((n) => n.status === "running").length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => {
    setOpen((o) => {
      if (!o) markNoticesRead();
      return !o;
    });
  };

  const jump = async (issueId: string) => {
    setOpen(false);
    navigate("triage");
    await focusIssue(issueId);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={toggle}
        aria-label="Enrichment notifications"
        className={cn(
          "relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground",
          open && "bg-accent text-accent-foreground",
        )}
      >
        {running > 0 ? <Loader2 className="size-4 animate-spin text-primary" /> : <Bell className="size-4" />}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary font-mono text-[9px] font-bold text-primary-foreground">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-40 w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-pop anim-pop-in">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Enrichments
            </span>
            {notices.some((n) => n.status !== "running") && (
              <button
                onClick={clearDoneNotices}
                className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              >
                clear finished
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {notices.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No enrichments this session. Start one and keep triaging — it finishes in the
                background and lands here.
              </p>
            )}
            {notices.map((n) => (
              <button
                key={n.runId}
                onClick={() => jump(n.issueId)}
                className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/60"
              >
                {n.status === "running" && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />}
                {n.status === "done" && <Check className="mt-0.5 size-3.5 shrink-0 text-success" />}
                {n.status === "error" && <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-semibold">{n.identifier}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {n.status === "running" ? "investigating…" : timeAgo(n.at)}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {n.status === "done" && (VERDICT_LABEL[n.verdict ?? ""] ?? "Report ready")}
                    {n.status === "error" && (n.error ?? "failed")}
                    {n.status === "running" && "click to watch live"}
                  </span>
                </span>
                {!n.read && n.status !== "running" && (
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

