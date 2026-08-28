// Deep enrichment UI: live per-scout progress + Claude-Code-style thinking
// feed streamed over SSE, then the fixed-schema report, plus the action log.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileSearch,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  ScrollText,
  Sparkles,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { DeepReport, EnrichEvent } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MarkdownInline } from "@/components/Markdown";
import { cn } from "@/lib/utils";

const AGENT_LABEL: Record<string, string> = {
  repo: "Repository",
  github: "GitHub",
  linear: "Linear",
  datadog: "Datadog",
  gcloud: "GCloud",
  synthesis: "Synthesis",
  orchestrator: "Run",
};

type ScoutState = "pending" | "running" | "done" | "error";

export function LiveRun({ events, running }: { events: EnrichEvent[]; running: boolean }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const scouts = useMemo(() => {
    const state: Record<string, ScoutState> = {};
    for (const ev of events) {
      if (ev.agent === "orchestrator" && ev.kind === "status" && Array.isArray(ev.payload?.scouts)) {
        for (const s of ev.payload.scouts) state[s] ??= "pending";
        state["synthesis"] = "pending";
      }
      if (!AGENT_LABEL[ev.agent] || ev.agent === "orchestrator") continue;
      if (ev.kind === "status" && ev.payload?.state === "running") state[ev.agent] = "running";
      if (ev.kind === "result") state[ev.agent] = "done";
      if (ev.kind === "error") state[ev.agent] = "error";
    }
    // synthesis done when report arrives
    if (events.some((e) => e.kind === "report")) state["synthesis"] = "done";
    return state;
  }, [events]);

  const feed = useMemo(
    () =>
      events.filter(
        (e) => e.kind === "thought" || e.kind === "tool_call" || e.kind === "toolbox" || e.kind === "error",
      ),
    [events],
  );

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [feed.length]);

  return (
    <div className="overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.045]">
      <div className="flex items-center gap-1.5 border-b border-primary/15 px-4 py-2.5">
        <Sparkles className={cn("size-4 shrink-0 text-primary", running && "animate-pulse")} />
        <span className="shrink-0 whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-primary">
          Deep enrichment
        </span>
        <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
          {Object.entries(scouts).map(([name, st]) => (
            <span
              key={name}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium",
                st === "running" && "border-info/40 bg-info/10 text-info",
                st === "done" && "border-success/40 bg-success/10 text-success",
                st === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
                st === "pending" && "border-border bg-surface-2 text-muted-foreground",
              )}
            >
              {st === "running" && <Loader2 className="size-2.5 animate-spin" />}
              {st === "done" && <Check className="size-2.5" />}
              {st === "error" && <TriangleAlert className="size-2.5" />}
              {AGENT_LABEL[name] ?? name}
            </span>
          ))}
        </span>
      </div>
      <div ref={feedRef} className="max-h-56 space-y-1.5 overflow-y-auto px-4 py-3">
        {feed.length === 0 && (
          <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Spinning up scouts…
          </p>
        )}
        {feed.map((ev) => (
          <FeedLine key={`${ev.seq}`} ev={ev} />
        ))}
      </div>
    </div>
  );
}

function FeedLine({ ev }: { ev: EnrichEvent }) {
  const who = AGENT_LABEL[ev.agent] ?? ev.agent;
  if (ev.kind === "thought")
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="mr-1.5 font-mono text-[10px] font-semibold text-primary/70">{who}</span>
        <span className="italic">{String(ev.payload?.text ?? "").slice(0, 500)}</span>
      </p>
    );
  if (ev.kind === "toolbox")
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Wrench className="mt-0.5 size-3 shrink-0 text-info" />
        <span className="min-w-0">
          <span className="mr-1.5 font-mono text-[10px] font-semibold text-primary/70">{who}</span>
          <code className="break-all font-mono text-[11px]">
            {ev.payload?.tool} {(ev.payload?.args ?? []).join(" ").slice(0, 160)}
          </code>
          {ev.payload?.error && <span className="ml-1 text-destructive">({ev.payload.error})</span>}
        </span>
      </p>
    );
  if (ev.kind === "tool_call")
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <FileSearch className="mt-0.5 size-3 shrink-0 text-info" />
        <span className="min-w-0">
          <span className="mr-1.5 font-mono text-[10px] font-semibold text-primary/70">{who}</span>
          <code className="break-all font-mono text-[11px]">
            {ev.payload?.tool} {summarizeInput(ev.payload?.input)}
          </code>
        </span>
      </p>
    );
  if (ev.kind === "error")
    return (
      <p className="text-xs text-destructive">
        <span className="mr-1.5 font-mono text-[10px] font-semibold">{who}</span>
        {String(ev.payload?.error ?? "error").slice(0, 300)}
      </p>
    );
  return null;
}

function summarizeInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.slice(0, 160);
  try {
    const o = input as Record<string, unknown>;
    const interesting = o.command ?? o.pattern ?? o.file_path ?? o.path ?? o.query;
    if (typeof interesting === "string") return interesting.slice(0, 160);
    return JSON.stringify(o).slice(0, 160);
  } catch {
    return "";
  }
}

/** Build a Linear issue URL from an identifier, using the current issue's URL as a template. */
export function linearIssueHref(identifier: string, fromIssueUrl?: string, explicit?: string): string | undefined {
  if (explicit && /^https?:/.test(explicit)) return explicit;
  if (!identifier || !fromIssueUrl) return undefined;
  const m = fromIssueUrl.match(/^(https:\/\/linear\.app\/[^/]+\/issue\/)/);
  return m ? m[1] + identifier : undefined;
}

// formatReportComment renders the deep report as Linear-flavored markdown
// suitable for posting back as a comment. issueUrl (the current issue's
// Linear URL) is used to turn related-issue identifiers into links.
export function formatReportComment(r: DeepReport, issueUrl?: string): string {
  const v = VERDICT_META[r.verdict]?.label ?? r.verdict;
  const lines: string[] = [];
  lines.push(`**AI triage report — ${v}** (${Math.round((r.confidence ?? 0) * 100)}% confidence)`);
  lines.push("");
  lines.push(r.summary);
  if (r.reasoning) {
    lines.push("");
    lines.push(`**Reasoning:** ${r.reasoning}`);
  }
  if (r.recommendation) {
    lines.push("");
    lines.push(`**Recommendation:** ${r.recommendation}`);
  }
  if (r.evidence?.length) {
    lines.push("");
    lines.push("**Evidence**");
    for (const e of r.evidence) {
      const link = e.link ? (/^https?:/.test(e.link) ? ` ([link](${e.link}))` : ` (\`${e.link}\`)`) : "";
      lines.push(`- **${e.source}** — ${e.finding}${link}`);
    }
  }
  if (r.relatedPRs?.length) {
    lines.push("");
    lines.push(
      "**Related PRs:** " +
        r.relatedPRs
          .map((pr) => (pr.url ? `[${pr.repo}#${pr.number}](${pr.url}) (${pr.state})` : `${pr.repo}#${pr.number} (${pr.state})`))
          .join(" · "),
    );
  }
  if (r.relatedIssues?.length) {
    lines.push("");
    lines.push(
      "**Related issues:** " +
        r.relatedIssues
          .map((ri) => {
            const href = linearIssueHref(ri.identifier, issueUrl, ri.url);
            return href ? `[${ri.identifier}](${href}) (${ri.state})` : `${ri.identifier} (${ri.state})`;
          })
          .join(" · "),
    );
  }
  lines.push("");
  lines.push("*Generated by Rapid Triage deep enrichment.*");
  return lines.join("\n");
}

const VERDICT_META: Record<string, { label: string; tone: string }> = {
  actionable: { label: "Still actionable", tone: "border-success/35 bg-success/10 text-success" },
  likely_obsolete: { label: "Likely obsolete", tone: "border-destructive/35 bg-destructive/10 text-destructive" },
  possibly_done: { label: "Possibly already done", tone: "border-info/35 bg-info/10 text-info" },
  needs_info: { label: "Needs more info", tone: "border-info/35 bg-info/10 text-info" },
  duplicate_suspect: {
    label: "Duplicate suspect",
    tone: "border-warning/45 bg-warning/15 text-warning-foreground dark:text-warning",
  },
};

const SOURCE_TONE: Record<string, string> = {
  repo: "text-info",
  github: "text-primary",
  linear: "text-success",
  datadog: "text-warning-foreground dark:text-warning",
  gcloud: "text-destructive",
};

// ReportView renders the fixed-schema deep report. Sections render only when
// their data exists, in a stable order across executions.
export function ReportView({
  report,
  runId,
  issueUrl,
  stale,
  onReenrich,
  onPost,
  onRegenerate,
}: {
  report: DeepReport;
  runId?: string | null;
  issueUrl?: string;
  stale?: boolean;
  onReenrich?: () => void;
  onPost?: () => Promise<void>;
  onRegenerate?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const v = VERDICT_META[report.verdict] ?? VERDICT_META.actionable;
  const post = async () => {
    if (!onPost) return;
    setPosting(true);
    try {
      await onPost();
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.045]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-primary/[0.07]"
      >
        <Sparkles className="size-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">Deep report</span>
        <span className={cn("ml-auto truncate rounded-full border px-2 py-0.5 text-[11px] font-medium", v.tone)}>
          {v.label}
          {report.confidence > 0 && (
            <span className="ml-1 font-mono opacity-70">{Math.round(report.confidence * 100)}%</span>
          )}
        </span>
        {open ? (
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-primary/15 px-4 py-3">
          {stale && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground dark:text-warning">
              <TriangleAlert className="size-3.5 shrink-0" />
              <span className="flex-1">
                Possibly out-of-date — the issue's title or description changed after this analysis.
              </span>
              {onReenrich && (
                <button onClick={onReenrich} className="shrink-0 cursor-pointer font-semibold hover:underline">
                  Re-enrich
                </button>
              )}
            </div>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">
            <MarkdownInline source={report.summary} />
          </p>
          {report.reasoning && (
            <p className="text-xs leading-relaxed text-muted-foreground/85">
              <MarkdownInline source={report.reasoning} />
            </p>
          )}
          {report.recommendation && (
            <p className="rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-medium text-foreground">
              → <MarkdownInline source={report.recommendation} />
            </p>
          )}

          {report.evidence?.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence</h4>
              <ul className="mt-1.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                {report.evidence.map((e, i) => (
                  <li key={i} className="contents text-xs text-muted-foreground">
                    <span className={cn("mt-px font-mono text-[10px] font-bold uppercase", SOURCE_TONE[e.source] ?? "")}>
                      {e.source}
                    </span>
                    <span className="min-w-0">
                      <MarkdownInline source={e.finding} />
                      {e.link && <ELink href={e.link} />}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.relatedIssues?.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Related issues</h4>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {report.relatedIssues.map((ri, i) => {
                  const href = linearIssueHref(ri.identifier, issueUrl, ri.url);
                  const chip = (
                    <>
                      <span className="font-mono">{ri.identifier}</span> · {ri.state}
                      {ri.relation ? ` · ${ri.relation}` : ""}
                      {href && <ExternalLink className="size-2.5 opacity-60" />}
                    </>
                  );
                  const cls =
                    "inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-muted-foreground";
                  return href ? (
                    <a
                      key={i}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(cls, "hover:text-primary")}
                      title={ri.title}
                    >
                      {chip}
                    </a>
                  ) : (
                    <span key={i} className={cls} title={ri.title}>
                      {chip}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {report.relatedPRs?.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Related PRs</h4>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {report.relatedPRs.map((pr, i) => (
                  <a
                    key={i}
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-primary"
                    title={pr.title}
                  >
                    <span className="font-mono">
                      {pr.repo}#{pr.number}
                    </span>
                    · {pr.state}
                    <ExternalLink className="size-2.5 opacity-60" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-primary/10 pt-2">
            {report.sources && (
              <span className="flex min-w-0 flex-wrap gap-1.5">
                {Object.entries(report.sources).map(([name, st]) => (
                  <span
                    key={name}
                    className={cn(
                      "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px]",
                      st.status === "done"
                        ? "border-success/30 bg-success/5 text-success"
                        : "border-destructive/30 bg-destructive/5 text-destructive",
                    )}
                    title={st.error}
                  >
                    {AGENT_LABEL[name] ?? name} · {st.elapsed}
                  </span>
                ))}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-3">
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-[11px] font-medium text-primary hover:underline"
                  title="Re-run enrichment with the mode configured in Settings"
                >
                  <RefreshCw className="size-3" /> Regenerate
                </button>
              )}
              {onPost && (
                <button
                  onClick={post}
                  disabled={posting}
                  className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                >
                  {posting ? <Loader2 className="size-3 animate-spin" /> : <MessageSquarePlus className="size-3" />}
                  Post to Linear
                </button>
              )}
              {runId && (
                <button
                  onClick={() => setLogOpen(true)}
                  className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-[11px] font-medium text-primary hover:underline"
                >
                  <ScrollText className="size-3" /> Action log
                </button>
              )}
            </span>
          </div>
        </div>
      )}
      {runId && <ActionLogDialog runId={runId} open={logOpen} onClose={() => setLogOpen(false)} />}
    </div>
  );
}

function ELink({ href }: { href: string }) {
  const external = /^https?:/.test(href);
  if (!external)
    return <code className="ml-1 rounded bg-surface-2 px-1 font-mono text-[10px]">{href}</code>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center text-primary hover:underline">
      link <ExternalLink className="ml-0.5 size-2.5" />
    </a>
  );
}

// ActionLogDialog shows the complete persisted event log for a run.
function ActionLogDialog({ runId, open, onClose }: { runId: string; open: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<EnrichEvent[] | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/enrich/runs/${runId}/log`)
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []));
  }, [open, runId]);

  return (
    <Dialog open={open} onClose={onClose} title="Enrichment action log" className="sm:max-w-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Every prompt, thought, tool call, and result from this run.
        </span>
        <a
          href={`/api/enrich/runs/${runId}/log`}
          download
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Download className="size-3" /> Download JSON
        </a>
      </div>
      <div className="max-h-[60vh] space-y-1 overflow-y-auto rounded-lg border border-border bg-surface-2/50 p-2 font-mono text-[11px] leading-relaxed">
        {!events && (
          <p className="flex items-center gap-2 p-3 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Loading…
          </p>
        )}
        {events?.map((ev) => (
          <details key={ev.seq} className="rounded px-1.5 py-0.5 hover:bg-accent/40">
            <summary className="cursor-pointer select-none truncate text-muted-foreground">
              <span className="text-primary/70">{String(ev.seq).padStart(3, "0")}</span>{" "}
              <span className="font-semibold">{ev.agent}</span> · {ev.kind}
              <span className="ml-2 opacity-60">{ev.at?.slice(11, 19)}</span>
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-2 text-[10px]">
              {JSON.stringify(ev.payload, null, 1)}
            </pre>
          </details>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}

export { ActivityIcon };
