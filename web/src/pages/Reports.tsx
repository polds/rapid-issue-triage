// Gamified report page: stat tiles, per-day bar chart, outcome donut,
// session speed stats, the recent activity feed, and what AI enrichment has
// spent. Charts are hand-rolled SVG following the mark specs: thin marks,
// rounded data-ends, 2px surface gaps, hover tooltips, labeled legend
// (identity never color-alone).
import { useEffect, useState } from "react";
import { Coins, Cpu, Flame, Gauge, Loader2, Sparkles, Timer, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import type { Report, TokenSlice, TokenTotals, TokenUsageReport } from "@/lib/types";
import { fmtMs, fmtTokens, fmtUsd, timeAgo } from "@/lib/utils";

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

// The closed set of enrichment responsibilities, in the order they read as a
// pipeline. "fast" is the single-call enricher; the rest are deep-run agents.
// An unknown key still renders — the set is mirrored, not enforced, here.
const AGENT_LABEL: Record<string, string> = {
  fast: "Fast enrichment",
  repo: "Repo scout",
  github: "GitHub scout",
  linear: "Linear scout",
  datadog: "Datadog scout",
  gcloud: "Cloud scout",
  synthesis: "Synthesis",
  orchestrator: "Orchestrator",
};

// Three kinds, because this is the split that decides what a call costs:
// fresh input (whether or not it was written to cache), cached input replayed
// at a fraction of the price, and output. Hues are the page's existing
// categorical tokens; every segment is labeled below, so identity is never
// carried by color alone.
const TOKEN_KINDS = [
  { key: "input", label: "Input", color: "var(--chart-4)" },
  { key: "cached", label: "Cached input", color: "var(--chart-3)" },
  { key: "output", label: "Output", color: "var(--chart-1)" },
] as const;

function kindSegments(t: TokenTotals) {
  const values = [t.input + t.cacheCreation, t.cacheRead, t.output];
  return TOKEN_KINDS.map((k, i) => ({ ...k, value: values[i] }));
}

function agentLabel(key: string): string {
  return AGENT_LABEL[key] ?? key;
}

/** One responsibility's share of the spend: a bar scaled to the heaviest. */
function AgentRow({ slice, max, total }: { slice: TokenSlice; max: number; total: number }) {
  const share = total > 0 ? Math.round((slice.total / total) * 100) : 0;
  // Floor the width so a real but tiny spender still shows a mark.
  const width = max > 0 ? Math.max(1.5, (slice.total / max) * 100) : 0;
  const label = agentLabel(slice.key);
  return (
    <div className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 py-1.5">
      <span className="truncate text-xs text-muted-foreground" title={label}>
        {label}
      </span>
      <div
        className="h-2.5 rounded-full bg-surface-2"
        title={`${label}: ${slice.total.toLocaleString()} tokens across ${slice.calls} call${slice.calls === 1 ? "" : "s"} · ${share}% · ${fmtUsd(slice.costUsd)}`}
      >
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: "var(--chart-5)" }} />
      </div>
      <span className="shrink-0 text-right font-mono text-xs tabular-nums">
        {fmtTokens(slice.total)}
        <span className="ml-2 text-muted-foreground">{fmtUsd(slice.costUsd)}</span>
      </span>
    </div>
  );
}

/** One stacked bar splitting the whole spend by token kind, plus its legend. */
function CompositionBar({ totals }: { totals: TokenTotals }) {
  const segs = kindSegments(totals).filter((s) => s.value > 0);
  const sum = segs.reduce((a, s) => a + s.value, 0);
  if (!sum) return null;
  return (
    <div>
      {/* 2px surface gaps between segments, per the mark specs. */}
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {segs.map((s) => (
          <div
            key={s.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / sum) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value.toLocaleString()} tokens (${Math.round((s.value / sum) * 100)}%)`}
          />
        ))}
      </div>
      <div className="mt-3 grid gap-1.5">
        {segs.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-mono tabular-nums">
              {fmtTokens(s.value)} · {Math.round((s.value / sum) * 100)}%
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Cached input is replayed context, billed at a fraction of fresh input — which is why the
        total dwarfs what the work actually cost. {fmtTokens(totals.cacheCreation)} of the input was
        written to cache.
      </p>
    </div>
  );
}

/** What AI enrichment has spent, aggregated and split by responsibility. */
function TokenPanel({ tokens }: { tokens: TokenUsageReport }) {
  const { totals } = tokens;
  const perIssue = tokens.issues > 0 ? totals.total / tokens.issues : 0;
  const max = tokens.byAgent.length > 0 ? tokens.byAgent[0].total : 0;
  const modes = tokens.byMode.map((m) => `${m.key} ${m.calls}`).join(" · ");

  if (totals.calls === 0) {
    return (
      <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-card">
        <h2 className="text-sm font-semibold">AI enrichment usage</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing recorded yet. Enrich an issue and its token usage lands here — counts come from
          the Claude Code CLI&rsquo;s own accounting, so enrichments that ran before this was
          tracked are not included.
        </p>
      </div>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-bold tracking-tight">AI enrichment usage</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Reported by the Claude Code CLI, not estimated. Cost is its list-price figure — on a Claude
        subscription no money changes hands per call, so read it as an equivalent.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Total tokens"
          value={fmtTokens(totals.total)}
          hint={`${fmtTokens(tokens.today.total)} today · ${fmtTokens(tokens.week.total)} this week`}
          icon={<Cpu className="size-3.5" />}
        />
        <Tile
          label="Est. cost"
          value={fmtUsd(totals.costUsd)}
          hint={`${fmtUsd(tokens.today.costUsd)} today · ${fmtUsd(tokens.week.costUsd)} this week`}
          icon={<Coins className="size-3.5 text-warning" />}
        />
        <Tile
          label="Enrichment calls"
          value={totals.calls.toLocaleString()}
          hint={modes || undefined}
          icon={<Sparkles className="size-3.5" />}
        />
        <Tile
          label="Avg / issue"
          value={fmtTokens(perIssue)}
          hint={`over ${tokens.issues} issue${tokens.issues === 1 ? "" : "s"}`}
          icon={<Gauge className="size-3.5" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h3 className="text-sm font-semibold">By responsibility</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Which agent spent it — the fast enricher, each deep-run scout, and the synthesis pass.
          </p>
          <div className="mt-4">
            {tokens.byAgent.map((a) => (
              <AgentRow key={a.key} slice={a} max={max} total={totals.total} />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h3 className="text-sm font-semibold">What the tokens were</h3>
          <div className="mt-4">
            <CompositionBar totals={totals} />
          </div>
        </div>
      </div>

      {tokens.models.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Models: {tokens.models.join(", ")}
          {tokens.since ? ` · tracked since ${timeAgo(tokens.since)}` : ""}
        </p>
      )}
    </section>
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

      <TokenPanel tokens={report.tokens} />
    </main>
  );
}
