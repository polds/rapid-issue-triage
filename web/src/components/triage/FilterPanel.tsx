// View-filter panel: tri-state team/label rows (neutral → include → exclude),
// priority toggles, text search, recent filters, and the advanced Linear
// index-filter editor. View filters are instant (local index); the index
// filter triggers a background reindex.
import { useEffect, useMemo, useState } from "react";
import { Check, Eye, Filter as FilterIcon, Link2, Loader2, Minus, RotateCcw, X } from "lucide-react";
import { useTriage } from "@/lib/store";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EMPTY_FILTER, filterIsEmpty, type CustomView, type IndexFilterInfo, type ViewFilter } from "@/lib/types";
import { cn, PRIORITY_NAMES } from "@/lib/utils";

type Tri = "none" | "include" | "exclude";

function triOf(id: string, inc: string[], exc: string[]): Tri {
  if (inc.includes(id)) return "include";
  if (exc.includes(id)) return "exclude";
  return "none";
}

function cycle(id: string, inc: string[], exc: string[]): [string[], string[]] {
  switch (triOf(id, inc, exc)) {
    case "none":
      return [[...inc, id], exc];
    case "include":
      return [inc.filter((x) => x !== id), [...exc, id]];
    case "exclude":
      return [inc, exc.filter((x) => x !== id)];
  }
}

function TriRow({ label, state, onClick, color }: { label: string; state: Tri; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/60",
        state === "include" && "bg-success/10 text-success",
        state === "exclude" && "bg-destructive/10 text-destructive line-through",
      )}
    >
      {color && <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="flex-1 truncate">{label}</span>
      {state === "include" && <Check className="size-4" />}
      {state === "exclude" && <Minus className="size-4" />}
    </button>
  );
}

// decodeLinearFilterURL extracts and decodes the base64url `filter` param
// from a linear.app view/filter URL into IssueFilter JSON.
export function decodeLinearFilterURL(input: string): Record<string, unknown> {
  let raw = input.trim();
  try {
    const u = new URL(raw);
    raw = u.searchParams.get("filter") ?? "";
  } catch {
    /* not a URL — treat as the bare base64 payload */
  }
  if (!raw) throw new Error("no ?filter= parameter found in that URL");
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (raw.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof parsed !== "object" || parsed === null) throw new Error("decoded payload is not a filter object");
  return parsed as Record<string, unknown>;
}

// ViewsColumn lists saved Linear views; picking one makes its filter the
// index filter (validated server-side, background reindex).
function ViewsColumn({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [views, setViews] = useState<CustomView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    api
      .views()
      .then((r) => setViews(r.views ?? []))
      .catch((e) => setError((e as Error).message));
  }, []);

  const applyView = async (v: CustomView) => {
    setApplying(v.id);
    try {
      await api.putIndexFilter(v.filterData);
      toast(`Queue is now “${v.name}” — reindexing from Linear`);
      onClose();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setApplying(null);
    }
  };

  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Use a Linear view
      </h3>
      <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
        Makes the view's filter the whole queue (reindexes in the background).
      </p>
      <div className="grid max-h-[380px] gap-1 overflow-y-auto rounded-lg border border-border p-1">
        {error && <p className="px-2 py-4 text-xs text-destructive">Couldn't load views: {error}</p>}
        {!views && !error && (
          <p className="inline-flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading views…
          </p>
        )}
        {views?.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">No saved views in this workspace.</p>
        )}
        {(views ?? []).map((v) => (
          <button
            key={v.id}
            onClick={() => applyView(v)}
            disabled={applying !== null}
            className="group flex w-full cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/60 disabled:opacity-60"
          >
            <Eye className="mt-0.5 size-3.5 shrink-0" style={{ color: v.color || "var(--muted-foreground)" }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{v.name}</span>
              {v.description && (
                <span className="block truncate text-[11px] text-muted-foreground">{v.description}</span>
              )}
            </span>
            {applying === v.id && <Loader2 className="mt-0.5 size-3.5 animate-spin text-primary" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function IndexFilterEditor({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [info, setInfo] = useState<IndexFilterInfo | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.getIndexFilter().then((i) => {
      setInfo(i);
      setText(JSON.stringify(i.filter, null, 2));
    });
  useEffect(() => {
    load().catch((e) => toast(`Load failed: ${(e as Error).message}`, { tone: "error" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      toast(`Invalid JSON: ${(e as Error).message}`, { tone: "error" });
      return;
    }
    setSaving(true);
    try {
      await api.putIndexFilter(parsed);
      toast("Index filter saved — reindexing from Linear in the background");
      onClose();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      await api.resetIndexFilter();
      toast("Reverted to the config default — reindexing");
      onClose();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const [urlInput, setUrlInput] = useState("");
  const convert = () => {
    try {
      const parsed = decodeLinearFilterURL(urlInput);
      setText(JSON.stringify(parsed, null, 2));
      toast("Converted — review, then Validate & reindex. App-only fields (if any) will be rejected by validation with Linear's error.");
    } catch (e) {
      toast(`Convert failed: ${(e as Error).message}`, { tone: "error" });
    }
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Convert a Linear filter URL</span>
        <div className="flex gap-2">
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste a linear.app view URL with ?filter=…"
            className="h-9 flex-1 rounded-md border border-input bg-surface px-3 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button variant="quiet" size="sm" className="h-9" onClick={convert} disabled={!urlInput.trim()}>
            <Link2 /> Convert
          </Button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        This is the raw{" "}
        <a
          href="https://developers.linear.app/docs/graphql/filtering"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          Linear IssueFilter
        </a>{" "}
        controlling <strong className="text-foreground">what gets indexed</strong>. Saving validates it
        against Linear, then reindexes in the background — the current queue keeps serving while that
        runs, and issues that no longer match are pruned when it finishes.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        spellCheck={false}
        className="w-full rounded-lg border border-input bg-surface-2 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {info?.recent && info.recent.length > 0 && (
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">Recent index filters</span>
          {info.recent.slice(0, 5).map((r, i) => (
            <button
              key={i}
              onClick={() => setText(JSON.stringify(r.filter, null, 2))}
              className="cursor-pointer truncate rounded-md border border-border bg-surface px-2 py-1 text-left font-mono text-[11px] text-muted-foreground hover:bg-accent"
              title="Load into editor"
            >
              {JSON.stringify(r.filter)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={reset} disabled={saving || !info?.overridden}>
          <RotateCcw /> Reset to config default
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null} Validate & reindex
        </Button>
      </div>
    </div>
  );
}

export function FilterPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { meta, viewFilter, setViewFilter, recentFilters } = useTriage();
  const [draft, setDraft] = useState<ViewFilter>(viewFilter);
  const [labelQuery, setLabelQuery] = useState("");
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(viewFilter);
      setAdvanced(false);
    }
  }, [open, viewFilter]);

  const labelNames = useMemo(
    () => [...new Set((meta?.labels ?? []).filter((l) => !l.isGroup).map((l) => l.name))].sort(),
    [meta],
  );
  const shownLabels = useMemo(() => {
    const q = labelQuery.trim().toLowerCase();
    const all = q ? labelNames.filter((n) => n.toLowerCase().includes(q)) : labelNames;
    // Active ones always visible on top
    const active = new Set([...draft.labels, ...draft.excludeLabels]);
    return [...labelNames.filter((n) => active.has(n)), ...all.filter((n) => !active.has(n))].slice(0, 40);
  }, [labelNames, labelQuery, draft]);

  const teamKey = (id: string) => meta?.teams.find((t) => t.id === id)?.key ?? id.slice(0, 6);

  const apply = () => {
    setViewFilter(draft);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={advanced ? "Index filter (advanced)" : "Filter the queue"}
      className="sm:max-w-3xl"
    >
      {advanced ? (
        <IndexFilterEditor onClose={onClose} />
      ) : (
        <div className="grid gap-4">
          <p className="text-xs text-muted-foreground">
            Pick a saved Linear view — or build a local filter: click a team or label to cycle{" "}
            <span className="text-success">include</span> →{" "}
            <span className="text-destructive">exclude</span> → neutral. Built filters apply instantly.
          </p>

          <div className="grid gap-5 sm:grid-cols-2">
            <ViewsColumn onClose={onClose} />
            <div className="grid content-start gap-4 sm:border-l sm:border-border sm:pl-5">
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Teams
              </h3>
              <div className="grid max-h-44 gap-0.5 overflow-y-auto rounded-lg border border-border p-1">
                {(meta?.teams ?? []).map((t) => (
                  <TriRow
                    key={t.id}
                    label={`${t.key} · ${t.name}`}
                    state={triOf(t.id, draft.teams, draft.excludeTeams)}
                    onClick={() => {
                      const [inc, exc] = cycle(t.id, draft.teams, draft.excludeTeams);
                      setDraft({ ...draft, teams: inc, excludeTeams: exc });
                    }}
                  />
                ))}
              </div>

              <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Priority
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 0].map((p) => (
                  <button
                    key={p}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        priorities: draft.priorities.includes(p)
                          ? draft.priorities.filter((x) => x !== p)
                          : [...draft.priorities, p],
                      })
                    }
                    className={cn(
                      "cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors",
                      draft.priorities.includes(p)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-surface-2 text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {PRIORITY_NAMES[p]}
                  </button>
                ))}
              </div>

              <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Text search
              </h3>
              <input
                value={draft.search}
                onChange={(e) => setDraft({ ...draft, search: e.target.value })}
                placeholder="identifier or title…"
                className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Labels
              </h3>
              <input
                value={labelQuery}
                onChange={(e) => setLabelQuery(e.target.value)}
                placeholder="Search labels…"
                className="mb-1.5 h-8 w-full rounded-md border border-input bg-surface px-3 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="grid max-h-72 gap-0.5 overflow-y-auto rounded-lg border border-border p-1">
                {shownLabels.map((n) => (
                  <TriRow
                    key={n}
                    label={n}
                    state={triOf(n, draft.labels, draft.excludeLabels)}
                    onClick={() => {
                      const [inc, exc] = cycle(n, draft.labels, draft.excludeLabels);
                      setDraft({ ...draft, labels: inc, excludeLabels: exc });
                    }}
                  />
                ))}
              </div>
            </div>
            </div>
          </div>

          {recentFilters.length > 0 && (
            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Recent filters</span>
              <div className="flex flex-wrap gap-1.5">
                {recentFilters.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => setDraft({ ...EMPTY_FILTER, ...r.filter })}
                    className="cursor-pointer rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                    title="Load this filter"
                  >
                    {summarize(r.filter, teamKey)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <button
              onClick={() => setAdvanced(true)}
              className="cursor-pointer text-xs font-medium text-primary hover:underline"
            >
              Index filter (advanced) →
            </button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(EMPTY_FILTER)}>
                <X /> Clear
              </Button>
              <Button size="sm" onClick={apply}>
                <FilterIcon /> Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// summarize renders a compact human description of a saved filter.
export function summarize(f: ViewFilter, names: (id: string) => string): string {
  const parts: string[] = [];
  if (f.teams.length) parts.push(`in ${f.teams.map(names).join(",")}`);
  if (f.excludeTeams.length) parts.push(`not ${f.excludeTeams.map(names).join(",")}`);
  if (f.labels.length) parts.push(`+${f.labels.join(",")}`);
  if (f.excludeLabels.length) parts.push(`−${f.excludeLabels.join(",")}`);
  if (f.priorities.length) parts.push(f.priorities.map((p) => PRIORITY_NAMES[p]).join("/"));
  if (f.search.trim()) parts.push(`“${f.search.trim()}”`);
  return parts.join(" · ") || "empty";
}
export { filterIsEmpty };
