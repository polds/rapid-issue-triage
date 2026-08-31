// Bell dropdown tracking background enrichments. Clicking an entry jumps
// back to that card (pulling it into the deck if it paged out).
import { useEffect, useRef, useState } from "react";
import { Bell, Check, Clock, Loader2, TriangleAlert, X } from "lucide-react";
import { noticeDetail, noticeIsActive, noticeWhen } from "@/lib/notices";
import { useTriage } from "@/lib/triage-context";
import { cn } from "@/lib/utils";

export function NotificationBell({ navigate }: { navigate: (p: string) => void }) {
  const { notices, markNoticesRead, clearDoneNotices, dismissNotice, focusIssue } = useTriage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const unread = notices.filter((n) => !n.read && !noticeIsActive(n)).length;
  // Queued runs keep the bell spinning: the work is accepted, just not started.
  const active = notices.filter(noticeIsActive).length;

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
        {active > 0 ? <Loader2 className="size-4 animate-spin text-primary" /> : <Bell className="size-4" />}
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
            {notices.some((n) => !noticeIsActive(n)) && (
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
              // A row is a jump target plus its own dismiss control, so the
              // two are siblings — a button cannot nest inside a button.
              <div key={n.runId} className="group relative">
                <button
                  onClick={() => jump(n.issueId)}
                  className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg py-2 pl-2.5 pr-8 text-left transition-colors hover:bg-accent/60"
                >
                  {n.status === "queued" && <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                  {n.status === "running" && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />}
                  {n.status === "done" && <Check className="mt-0.5 size-3.5 shrink-0 text-success" />}
                  {n.status === "error" && <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-xs font-semibold">{n.identifier}</span>
                      <span className="text-[11px] text-muted-foreground">{noticeWhen(n)}</span>
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">{noticeDetail(n)}</span>
                  </span>
                </button>
                {!n.read && !noticeIsActive(n) && (
                  <span className="pointer-events-none absolute right-3 top-3.5 size-1.5 rounded-full bg-primary transition-opacity group-hover:opacity-0" />
                )}
                {/* Dismissing an active run would orphan it — the notice is
                    what the card and the live panel read — so finished
                    entries only. Hidden until hover, but always focusable. */}
                {!noticeIsActive(n) && (
                  <button
                    onClick={() => dismissNotice(n.runId)}
                    aria-label={`Dismiss ${n.identifier} enrichment`}
                    title="Dismiss"
                    className="absolute right-1.5 top-2 cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

