// View-filter panel: tri-state team/label rows (neutral → include → exclude),
// priority toggles, text search, recent filters, and the advanced Linear
// index-filter editor. View filters are instant (local index); the index
// filter triggers a background reindex.
import { useEffect, useMemo, useState } from "react";
import { Check, Filter as FilterIcon, Loader2, Minus, RotateCcw, X } from "lucide-react";
import { useTriage } from "@/lib/store";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EMPTY_FILTER, filterIsEmpty, type IndexFilterInfo, type ViewFilter } from "@/lib/types";
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

  return (
    <div className="grid gap-3">
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
      className="sm:max-w-2xl"
    >
      {advanced ? (
        <IndexFilterEditor onClose={onClose} />
      ) : (
        <div className="grid gap-4">
          <p className="text-xs text-muted-foreground">
            Click a team or label to cycle: <span className="text-success">include</span> →{" "}
            <span className="text-destructive">exclude</span> → neutral. Filters apply instantly to the
            local index.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
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
