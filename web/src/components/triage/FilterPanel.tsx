// Queue-source panel: pick a saved Linear view (its filter becomes the index
// filter, background reindex), or edit the raw IssueFilter on the advanced
// page. All rich filtering lives in Linear itself.
import { useEffect, useState } from "react";
import { Eye, Link2, Loader2, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { CustomView, IndexFilterInfo } from "@/lib/types";
import { decodeLinearFilterURL } from "@/lib/linearfilter";

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
    <div className="min-w-0">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Use a Linear view
      </h3>
      <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
        Makes the view's filter the whole queue (reindexes in the background).
      </p>
      <div className="grid max-h-[380px] min-w-0 gap-1 overflow-y-auto overflow-x-hidden rounded-lg border border-border p-1">
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
            className="group flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/60 disabled:opacity-60"
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
  const [advanced, setAdvanced] = useState(false);

  // Every fresh open starts on the simple view. Adjusting during render is the
  // supported way to reset state on a prop change: the reset lands in the same
  // pass, so the advanced editor never flashes before it is cleared.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setAdvanced(false);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={advanced ? "Index filter (advanced)" : "Queue source"}
      className="sm:max-w-xl"
    >
      {advanced ? (
        <IndexFilterEditor onClose={onClose} />
      ) : (
        <div className="grid min-w-0 gap-4">
          <ViewsColumn onClose={onClose} />
          <div className="flex items-center justify-between border-t border-border pt-3">
            <button
              onClick={() => setAdvanced(true)}
              className="cursor-pointer text-xs font-medium text-primary hover:underline"
            >
              Index filter (advanced) →
            </button>
            <span className="text-[11px] text-muted-foreground">
              Filtering happens in Linear — build views there, use them here.
            </span>
          </div>
        </div>
      )}
    </Dialog>
  );
}
