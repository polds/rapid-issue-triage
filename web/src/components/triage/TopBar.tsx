import { useState } from "react";
import { ArrowUpCircle, BarChart3, Check, Filter as FilterIcon, Loader2, RefreshCw, Settings, TriangleAlert, Zap } from "lucide-react";
import { useTriage } from "@/lib/triage-context";
import { ThemeToggle } from "@/lib/theme";
import { Select } from "@/components/ui/select";
import { FilterPanel } from "./FilterPanel";
import { NotificationBell } from "./NotificationBell";
import { buildTooltip, displayVersion, hasUpdate, releaseHref } from "@/lib/version";
import { cn, timeAgo } from "@/lib/utils";

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

// The running build, beside the wordmark. It is a muted string until the
// background check finds a newer release, at which point it becomes the one
// call to action: a link straight to that release.
function VersionBadge() {
  const { version } = useTriage();
  if (!version) return null;
  const tip = buildTooltip(version);
  if (hasUpdate(version))
    return (
      <a
        href={releaseHref(version)}
        target="_blank"
        rel="noreferrer noopener"
        title={`${tip} — open the release notes`}
        className="inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info transition-colors hover:bg-info/20"
      >
        <ArrowUpCircle className="size-3" />
        {version.update.latest}
      </a>
    );
  return (
    <span title={tip} className="hidden font-mono text-[11px] text-muted-foreground lg:inline">
      {displayVersion(version)}
    </span>
  );
}

export function TopBar({ page, navigate }: { page: string; navigate: (p: string) => void }) {
  const { meta, viewFilter, setViewFilter, remaining } = useTriage();
  const [panel, setPanel] = useState(false);

  // The quick team select mirrors viewFilter.teams when it holds exactly one
  // team (and nothing else team-related); otherwise it shows All Teams.
  const quickTeam = viewFilter.teams.length === 1 ? viewFilter.teams[0] : "";

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
          <span className="font-display text-sm font-extrabold tracking-tight">Rapid Triage</span>
        </button>
        <VersionBadge />

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
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <FilterIcon className="size-3.5" />
          Views
        </button>

        <span className="hidden rounded-full border border-border bg-surface-2 px-2.5 py-1 font-mono text-xs text-muted-foreground sm:inline">
          {remaining} left
        </span>

        <div className="hidden sm:block">
          <SyncPill />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <NotificationBell navigate={navigate} />
          {navBtn("macros", <Zap className="size-4" />, "Macros")}
          {navBtn("reports", <BarChart3 className="size-4" />, "Reports")}
          {navBtn("settings", <Settings className="size-4" />, "Settings")}
          <ThemeToggle />
        </div>
      </div>
      <FilterPanel open={panel} onClose={() => setPanel(false)} />
    </header>
  );
}
