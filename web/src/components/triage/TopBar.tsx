import { useState } from "react";
import { BarChart3, Check, Filter as FilterIcon, Loader2, RefreshCw, TriangleAlert, X, Zap } from "lucide-react";
import { useTriage } from "@/lib/store";
import { ThemeToggle } from "@/lib/theme";
import { Select } from "@/components/ui/select";
import { FilterPanel, summarize } from "./FilterPanel";
import { EMPTY_FILTER, filterIsEmpty } from "@/lib/types";
import { cn, timeAgo, PRIORITY_NAMES } from "@/lib/utils";

function SyncPill() {
  const { sync, refreshSync } = useTriage();
  if (!sync) return null;
  if (sync.state === "syncing" || sync.reindexing)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {sync.reindexing && sync.state !== "syncing" ? "Reindex queued…" : sync.reindexing ? "Reindexing…" : "Syncing…"}
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

// Chips for each active filter facet, each individually removable.
function FilterChips() {
  const { viewFilter, setViewFilter, meta } = useTriage();
  if (filterIsEmpty(viewFilter)) return null;
  const teamKey = (id: string) => meta?.teams.find((t) => t.id === id)?.key ?? id.slice(0, 6);
  const chips: { label: string; remove: () => void }[] = [];
  const f = viewFilter;
  f.teams.forEach((t) =>
    chips.push({ label: `in ${teamKey(t)}`, remove: () => setViewFilter({ ...f, teams: f.teams.filter((x) => x !== t) }) }),
  );
  f.excludeTeams.forEach((t) =>
    chips.push({
      label: `not ${teamKey(t)}`,
      remove: () => setViewFilter({ ...f, excludeTeams: f.excludeTeams.filter((x) => x !== t) }),
    }),
  );
  f.labels.forEach((l) =>
    chips.push({ label: `+${l}`, remove: () => setViewFilter({ ...f, labels: f.labels.filter((x) => x !== l) }) }),
  );
  f.excludeLabels.forEach((l) =>
    chips.push({
      label: `−${l}`,
      remove: () => setViewFilter({ ...f, excludeLabels: f.excludeLabels.filter((x) => x !== l) }),
    }),
  );
  f.priorities.forEach((p) =>
    chips.push({
      label: PRIORITY_NAMES[p],
      remove: () => setViewFilter({ ...f, priorities: f.priorities.filter((x) => x !== p) }),
    }),
  );
  if (f.search.trim())
    chips.push({ label: `“${f.search.trim()}”`, remove: () => setViewFilter({ ...f, search: "" }) });

  return (
    <div className="border-t border-border/50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1.5 px-5 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Filters</span>
        {chips.map((c, i) => (
          <button
            key={i}
            onClick={c.remove}
            className="group inline-flex cursor-pointer items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
            title="Remove"
          >
            {c.label}
            <X className="size-3 opacity-50 group-hover:opacity-100" />
          </button>
        ))}
        <button
          onClick={() => setViewFilter(EMPTY_FILTER)}
          className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          clear all
        </button>
      </div>
    </div>
  );
}

export function TopBar({ page, navigate }: { page: string; navigate: (p: string) => void }) {
  const { meta, viewFilter, setViewFilter, remaining } = useTriage();
  const [panel, setPanel] = useState(false);

  // The quick team select mirrors viewFilter.teams when it holds exactly one
  // team (and nothing else team-related); otherwise it shows All Teams.
  const quickTeam =
    viewFilter.teams.length === 1 && viewFilter.excludeTeams.length === 0 ? viewFilter.teams[0] : "";
  const activeCount = [
    viewFilter.teams.length,
    viewFilter.excludeTeams.length,
    viewFilter.labels.length,
    viewFilter.excludeLabels.length,
    viewFilter.priorities.length,
    viewFilter.search.trim() ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

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
          value={quickTeam}
          onChange={(e) =>
            setViewFilter({ ...viewFilter, teams: e.target.value ? [e.target.value] : [], excludeTeams: [] })
          }
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

        <button
          onClick={() => setPanel(true)}
          className={cn(
            "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
            activeCount > 0
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              : "border-border bg-surface text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <FilterIcon className="size-3.5" />
          Filter
          {activeCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
              {activeCount}
            </span>
          )}
        </button>

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
      <FilterChips />
      <FilterPanel open={panel} onClose={() => setPanel(false)} />
    </header>
  );
}
