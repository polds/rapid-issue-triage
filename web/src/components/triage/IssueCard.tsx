import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Hash,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  User,
} from "lucide-react";
import type { Card } from "@/lib/store";
import { useTriage } from "@/lib/store";
import { api } from "@/lib/api";
import type { Comment, DeepReport, Enrichment } from "@/lib/types";
import { formatReportComment, LiveRun, ReportView } from "./DeepPanel";

import { Markdown } from "@/components/Markdown";
import { PriorityIcon } from "@/components/PriorityIcon";
import { Button } from "@/components/ui/button";
import { teamColor, labelColor } from "@/lib/colors";
import { cn, timeAgo } from "@/lib/utils";

const VERDICT_META: Record<Enrichment["verdict"], { label: string; tone: string }> = {
  actionable: { label: "Still actionable", tone: "border-success/35 bg-success/10 text-success" },
  likely_obsolete: {
    label: "Likely obsolete",
    tone: "border-destructive/35 bg-destructive/10 text-destructive",
  },
  possibly_done: {
    label: "Possibly already done",
    tone: "border-info/35 bg-info/10 text-info",
  },
  needs_info: { label: "Needs more info", tone: "border-info/35 bg-info/10 text-info" },
  duplicate_suspect: {
    label: "Duplicate suspect",
    tone: "border-warning/45 bg-warning/15 text-warning-foreground dark:text-warning",
  },
};

function AIPanel({ card }: { card: Card }) {
  const { enrich, enriching, meta, activeRunFor, getRunEvents, eventsTick, applyOps } = useTriage();
  const [open, setOpen] = useState(true);
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const e = card.issue.enrichment;

  // The store owns run watchers; this panel just renders the buffer for the
  // run attached to this card (eventsTick invalidates the memo as it grows).
  const runId = activeRunFor(card.issue.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const events = useMemo(() => (runId ? getRunEvents(runId) : []), [runId, getRunEvents, eventsTick]);

  // Lazily resolve the run id backing a stored report (for the action log).
  useEffect(() => {
    if (e?.report && !logRunId) {
      api.latestRun(card.issue.id).then((r) => r.run && setLogRunId(r.run.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e?.report, card.issue.id]);

  const startEnrich = enrich;

  if (!meta?.aiEnabled && !e) return null;

  if (runId) {
    return <LiveRun events={events} running />;
  }

  if (e?.report) {
    return (
      <ReportView
        report={e.report}
        runId={logRunId}
        stale={e.stale}
        onReenrich={startEnrich}
        onPost={() =>
          applyOps([{ type: "add_comment", body: formatReportComment(e.report!) }], "AI report posted")
        }
        onRegenerate={startEnrich}
      />
    );
  }

  if (!e) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-2/60 p-4 text-center">
        <p className="text-xs text-muted-foreground">No AI context yet for this issue.</p>
        <Button size="sm" className="mt-3" onClick={startEnrich} disabled={enriching}>
          {enriching ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {enriching ? "Enriching…" : "Enrich with AI"}
        </Button>
      </div>
    );
  }

  const v = VERDICT_META[e.verdict] ?? VERDICT_META.actionable;
  return (
    <div className="overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.045]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-primary/[0.07]"
      >
        <Sparkles className="size-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">AI context</span>
        <span
          className={cn("ml-auto truncate rounded-full border px-2 py-0.5 text-[11px] font-medium", v.tone)}
          title={e.reasoning}
        >
          {v.label}
        </span>
        {open ? (
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-primary/15 px-4 py-3">
          {e.stale && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground dark:text-warning">
              <TriangleAlert className="size-3.5 shrink-0" />
              <span className="flex-1">Possibly out-of-date — the issue changed after this analysis.</span>
              <button onClick={startEnrich} className="shrink-0 cursor-pointer font-semibold hover:underline">
                Re-enrich
              </button>
            </div>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">{e.summary}</p>
          {e.reasoning && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
              {e.reasoning}
              {e.confidence > 0 && (
                <span className="ml-1 font-mono">({Math.round(e.confidence * 100)}%)</span>
              )}
            </p>
          )}
          <div className="mt-2 flex justify-end border-t border-primary/10 pt-2">
            <button
              onClick={startEnrich}
              disabled={enriching}
              className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
              title="Re-run enrichment with the mode configured in Settings"
            >
              {enriching ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Comments({ issueId }: { issueId: string }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .context(issueId)
      .then((r) => alive && setComments(r.comments ?? []))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [issueId]);

  return (
    <div className="mt-5 border-t border-border pt-4">
      <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <MessageSquare className="size-3.5" /> Comments{comments ? ` · ${comments.length}` : ""}
      </h3>
      {error && <p className="mt-3 text-sm text-destructive">Couldn't load comments: {error}</p>}
      {!comments && !error && (
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </p>
      )}
      {comments && comments.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No comments on this issue.</p>
      )}
      {comments && comments.length > 0 && (
        <ol className="mt-3 space-y-3 border-l border-border pl-4">
          {comments.map((c) => (
            <li key={c.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-border" />
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">
                  {c.user?.displayName || c.user?.name || "someone"}
                </span>
                <span className="text-[11px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
              </div>
              <div className="mt-0.5">
                <Markdown source={c.body} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Collapsed descriptions render full markdown, clamped by CSS with a fade —
// the fade and "Show more" only appear when content actually overflows.
function Description({
  source,
  expanded,
  setExpanded,
  issueId,
}: {
  source: string;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  issueId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const empty = !source?.trim();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 4);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [issueId, expanded, source]);

  if (empty) {
    return (
      <>
        <p className="text-sm italic text-muted-foreground/70">No description.</p>
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Hide comments" : "Show comments"}
          <kbd className="kbd ml-1 h-4 text-[10px]">Space</kbd>
        </button>
      </>
    );
  }
  return (
    <>
      <div ref={ref} className={cn("relative", !expanded && "max-h-32 overflow-hidden")}>
        <Markdown source={source} />
        {!expanded && overflowing && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
            style={{ background: "linear-gradient(to top, var(--card), transparent)" }}
          />
        )}
      </div>
      {(overflowing || expanded) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
          <kbd className="kbd ml-1 h-4 text-[10px]">Space</kbd>
        </button>
      )}
    </>
  );
}

export function IssueCard({
  card,
  expanded,
  setExpanded,
}: {
  card: Card;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}) {
  const { swipe, meta } = useTriage();
  const issue = card.issue;
  const team = meta?.teams.find((t) => t.id === issue.teamId);
  const state = meta?.states.find((s) => s.id === issue.stateId);
  const project = meta?.projects.find((p) => p.id === issue.projectId);
  const cycle = meta?.cycles.find((c) => c.id === issue.cycleId);
  const assignee = meta?.users.find((u) => u.id === issue.assigneeId);

  useEffect(() => {
    setExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.id]);

  return (
    <article
      key={issue.id}
      className={cn(
        "surface-card relative rounded-2xl p-6 anim-card-in sm:p-7",
        swipe === "left" && "anim-swipe-left",
        swipe === "right" && "anim-swipe-right",
        swipe === "down" && "anim-swipe-down",
        card.status !== "pending" && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <a
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-sm font-medium text-muted-foreground hover:text-primary"
          title="Open in Linear"
        >
          {issue.identifier}
          <ExternalLink className="size-3 opacity-60" />
        </a>
        {team && (
          <span
            className="rounded-md border border-current/25 bg-current/10 px-2 py-0.5 text-[11px] font-semibold"
            style={{ color: teamColor(team.key) }}
          >
            {team.key}
          </span>
        )}
        <PriorityIcon priority={issue.priority} />
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" /> opened {timeAgo(issue.createdAt)}
        </span>
        {issue.creatorName && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="size-3.5" /> {issue.creatorName}
          </span>
        )}
        {card.status !== "pending" && (
          <span className="ml-auto rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {card.outcome ?? card.status}
          </span>
        )}
      </div>

      <h2 className="font-display mt-4 text-2xl font-bold leading-snug tracking-tight text-balance">
        {issue.title}
      </h2>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {state && (
          <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium">
            {state.name}
          </span>
        )}
        {(issue.labels ?? []).map((l) => (
          <span
            key={l.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
          >
            <span className="size-2 rounded-full" style={{ background: labelColor(l.color) }} />
            {l.name}
          </span>
        ))}
        {issue.estimate !== null && (
          <span className="inline-flex items-center gap-1 rounded-full border border-info/30 bg-info/10 px-2.5 py-1 text-[11px] font-medium text-info">
            <Hash className="size-3" />
            {issue.estimate} pts
          </span>
        )}
        {project && (
          <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-muted-foreground">
            {project.name}
          </span>
        )}
        {cycle && (
          <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-muted-foreground">
            Cycle {cycle.name || cycle.number}
          </span>
        )}
        {assignee && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2 py-1 text-[11px] text-muted-foreground">
            <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
              {(assignee.displayName || assignee.name).slice(0, 2).toUpperCase()}
            </span>
            {assignee.isMe ? "Assigned to me" : assignee.displayName || assignee.name}
          </span>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-5">
        <Description
          source={issue.description}
          expanded={expanded}
          setExpanded={setExpanded}
          issueId={issue.id}
        />
        {expanded && <Comments issueId={issue.id} />}
      </div>

      <div className="mt-5">
        <AIPanel card={card} />
      </div>
    </article>
  );
}
