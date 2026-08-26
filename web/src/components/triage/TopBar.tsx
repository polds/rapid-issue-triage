import { BarChart3, Check, Loader2, RefreshCw, TriangleAlert, Zap } from "lucide-react";
import { useTriage } from "@/lib/store";
import { ThemeToggle } from "@/lib/theme";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";

function SyncPill() {
  const { sync, refreshSync } = useTriage();
  if (!sync) return null;
  if (sync.state === "syncing")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Syncing…
      </span>
    );
  if (sync.state === "error")
    return (
      <button
        onClick={refreshSync}
        title={sync.lastError}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/20"
      >
        <TriangleAlert className="size-3.5" /> Sync error · retry
        <RefreshCw className="size-3" />
      </button>
    );
  if (sync.stale)
    return (
      <button
        onClick={refreshSync}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-warning/40 bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning-foreground transition-colors hover:bg-warning/25 dark:text-warning"
      >
        <TriangleAlert className="size-3.5" /> Stale · refresh
        <RefreshCw className="size-3" />
      </button>
    );
  return (
    <button
      onClick={refreshSync}
      title={sync.lastSyncedAt ? `Synced ${timeAgo(sync.lastSyncedAt)}` : undefined}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success transition-colors hover:bg-success/20"
    >
      <Check className="size-3.5" /> Fresh
    </button>
  );
}

export function TopBar({ page, navigate }: { page: string; navigate: (p: string) => void }) {
  const { meta, teamFilter, setTeamFilter, remaining } = useTriage();

  const navBtn = (target: string, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => navigate(target)}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-4",
        page === target && "bg-accent text-accent-foreground",
      )}
    >
      {icon} {label}
    </button>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5">
        <button onClick={() => navigate("triage")} className="flex cursor-pointer items-center gap-2 pr-1">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Rapid Triage</span>
        </button>

        <Select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="w-[176px]"
          aria-label="Team filter"
        >
          <option value="">All Teams</option>
          {(meta?.teams ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.key} · {t.name}
              {meta?.teamCounts?.[t.id] ? ` (${meta.teamCounts[t.id]})` : ""}
            </option>
          ))}
        </Select>

        <span className="hidden rounded-full border border-border bg-surface-2 px-2.5 py-1 font-mono text-xs text-muted-foreground sm:inline">
          {remaining} left
        </span>

        <div className="hidden sm:block">
          <SyncPill />
        </div>

        <div className="ml-auto flex items-center gap-1">
          {navBtn("macros", <Zap className="size-4" />, "Macros")}
          {navBtn("reports", <BarChart3 className="size-4" />, "Reports")}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
