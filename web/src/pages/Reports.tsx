// Gamified report page: stat tiles, per-day bar chart, outcome donut,
// session speed stats and the recent activity feed. Charts are hand-rolled
// SVG following the mark specs: thin marks, rounded data-ends, 2px surface
// gaps, hover tooltips, labeled legend (identity never color-alone).
import { useEffect, useState } from "react";
import { Flame, Gauge, Loader2, Timer, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import type { Report } from "@/lib/types";
import { fmtMs, timeAgo } from "@/lib/utils";

const OUTCOMES = [
  { key: "accepted", label: "Accepted", color: "var(--outcome-accepted)" },
  { key: "snoozed", label: "Snoozed", color: "var(--outcome-snoozed)" },
  { key: "cancelled", label: "Cancelled", color: "var(--outcome-cancelled)" },
  { key: "skipped", label: "Skipped", color: "var(--outcome-skipped)" },
  { key: "done", label: "Done", color: "var(--outcome-accepted)" },
  { key: "edited", label: "Edited", color: "var(--chart-5)" },
] as const;

function Tile({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-display mt-3 text-3xl font-bold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function BarChart({ data }: { data: { date: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 200, PAD = 4;
  const max = Math.max(1, ...data.map((d) => d.count));
  const bw = (W - PAD * 2) / data.length;
  const maxIdx = data.reduce((mi, d, i) => (d.count > data[mi].count ? i : mi), 0);

  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full" role="img" aria-label="Issues triaged per day, last 14 days">
      {data.map((d, i) => {
        const h = d.count === 0 ? 2 : Math.max(4, (d.count / max) * (H - 24));
        const x = PAD + i * bw + 3;
        const y = H - h;
        const showLabel = i === maxIdx && d.count > 0;
        return (
          <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {/* generous hit target */}
            <rect x={PAD + i * bw} y={0} width={bw} height={H} fill="transparent" />
            <rect
              x={x}
              y={y}
              width={bw - 6}
              height={h}
              rx={4}
              fill={d.count === 0 ? "var(--border)" : "var(--chart-5)"}
              opacity={hover === null || hover === i ? 1 : 0.45}
            >
              <title>{`${d.date}: ${d.count} triaged`}</title>
            </rect>
            {(showLabel || hover === i) && d.count > 0 && (
              <text
                x={x + (bw - 6) / 2}
                y={y - 6}
                textAnchor="middle"
                className="fill-[var(--muted-foreground)] font-mono text-[11px] tabular-nums"
              >
                {d.count}
              </text>
            )}
            {i % 2 === 0 && (
              <text
                x={x + (bw - 6) / 2}
                y={H + 16}
                textAnchor="middle"
                className="fill-[var(--muted-foreground)] text-[10px]"
              >
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ counts }: { counts: Record<string, number> }) {
  const [hover, setHover] = useState<string | null>(null);
  const entries = OUTCOMES.map((o) => ({ ...o, value: counts[o.key] ?? 0 })).filter((e) => e.value > 0);
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (!total)
    return <p className="py-10 text-center text-sm text-muted-foreground">No activity yet. Go triage something!</p>;

  const R = 68, r = 44, C = 88;
  // Each slice derives its own offset from the entries before it, so the map
  // callback stays pure: nothing is reassigned across renders.
  const arcs = entries.map((e, i) => {
    const before = entries.slice(0, i).reduce((s, x) => s + x.value, 0);
    const start = (before / total) * Math.PI * 2 - Math.PI / 2;
    const end = ((before + e.value) / total) * Math.PI * 2 - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;
    return {
      ...e,
      d: `M ${p(start, R)} A ${R} ${R} 0 ${large} 1 ${p(end, R)} L ${p(end, r)} A ${r} ${r} 0 ${large} 0 ${p(start, r)} Z`,
    };
  });

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 176 176" className="size-44 shrink-0" role="img" aria-label="Outcome breakdown">
        {arcs.map((a) => (
          <path
            key={a.key}
            d={a.d}
            fill={a.color}
            stroke="var(--card)"
            strokeWidth={2}
            opacity={hover === null || hover === a.key ? 1 : 0.4}
            onMouseEnter={() => setHover(a.key)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${a.label}: ${a.value} (${Math.round((a.value / total) * 100)}%)`}</title>
          </path>
        ))}
        <text x={C} y={C - 4} textAnchor="middle" className="fill-[var(--foreground)] text-xl font-semibold tabular-nums">
          {total}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" className="fill-[var(--muted-foreground)] text-[10px]">
          actions
        </text>
      </svg>
      <div className="grid flex-1 gap-1.5">
        {entries.map((e) => (
          <div
            key={e.key}
            className="flex items-center gap-2 text-xs"
            onMouseEnter={() => setHover(e.key)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="size-2.5 rounded-full" style={{ background: e.color }} />
            <span className="text-muted-foreground">{e.label}</span>
            <span className="ml-auto font-mono tabular-nums">
              {e.value} · {Math.round((e.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  macro: "macro", skip: "skipped", snooze: "snoozed", edit: "edited", undo: "undid",
};

export function ReportsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.report().then(setReport).catch((e) => setError((e as Error).message));
  }, []);

  if (error)
    return <main className="mx-auto max-w-5xl px-5 py-10 text-sm text-destructive">Failed to load report: {error}</main>;
  if (!report)
    return (
      <main className="mx-auto flex max-w-5xl justify-center px-5 py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
      <h1 className="font-display text-2xl font-bold tracking-tight">Reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">Momentum beats perfection. Keep the streak alive.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Today" value={String(report.today)} icon={<Gauge className="size-3.5" />} />
        <Tile label="This week" value={String(report.week)} icon={<Trophy className="size-3.5" />} />
        <Tile label="All time" value={report.allTime.toLocaleString()} icon={<Trophy className="size-3.5" />} />
        <Tile
          label="Current streak"
          value={`${report.streakDays} day${report.streakDays === 1 ? "" : "s"}`}
          icon={<Flame className="size-3.5 text-warning" />}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="text-sm font-semibold">Triaged per day · last 14 days</h2>
          <div className="mt-5">
            <BarChart data={report.byDay} />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="text-sm font-semibold">Outcome breakdown</h2>
          <div className="mt-4">
            <Donut counts={report.byOutcome} />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="text-sm font-semibold">Speed stats</h2>
          <div className="mt-4 grid gap-3">
            {[
              { label: "Fastest triage", value: fmtMs(report.fastestMs), icon: <Timer className="size-4 text-success" /> },
              { label: "Avg time / issue", value: fmtMs(report.avgMs), icon: <Timer className="size-4 text-info" /> },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                {s.icon}
                <span className="text-sm text-muted-foreground">{s.label}</span>
                <span className="ml-auto font-mono text-sm font-medium tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          <div className="mt-3 divide-y divide-border">
            {report.recent.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
            )}
            {report.recent.slice(0, 10).map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{a.issueIdentifier}</span>
                <span className="truncate">
                  {KIND_LABEL[a.kind] ?? a.kind} · {a.outcome}
                  {a.undone ? " (undone)" : ""}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
