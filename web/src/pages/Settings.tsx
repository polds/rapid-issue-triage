// Enrichment settings: fast vs deep mode, per-source toggles with live
// availability probes, time-impact estimates, and the read-only guarantee
// spelled out.
import { useEffect, useState } from "react";
import { Check, FolderOpen, Loader2, Lock, Plus, ShieldCheck, Trash2, TriangleAlert, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { invalidateEnrichInfo } from "@/lib/enrichmode";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import type { EnrichSettings, EnrichSettingsInfo, SourceKey } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOURCE_META: {
  key: SourceKey;
  name: string;
  what: string;
  estimate: string;
}[] = [
  { key: "repo", name: "Repository access", what: "Reads (Read/Grep/Glob only) the directories you list to check whether referenced code still exists or already changed.", estimate: "+30–90s" },
  { key: "github", name: "GitHub", what: "Searches PRs and code via your gh login to find work that already landed. Read-only subcommands only.", estimate: "+30–90s" },
  { key: "linear", name: "Linear", what: "Searches Linear for duplicates and checks the state of referenced issues, via this app's API key. Queries only.", estimate: "+20–60s" },
  { key: "datadog", name: "Datadog", what: "Searches logs and monitors to see whether the described problem still occurs. Uses DD_API_KEY/DD_APP_KEY, read APIs only.", estimate: "+30–90s" },
  { key: "gcloud", name: "Google Cloud", what: "Runs gcloud restricted to list/describe/get-iam-policy read verbs to inspect referenced infrastructure.", estimate: "+30–90s" },
];

export function SettingsPage() {
  const { toast } = useToast();
  const [info, setInfo] = useState<EnrichSettingsInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [newPath, setNewPath] = useState("");

  useEffect(() => {
    api.enrichSettings().then(setInfo).catch((e) => toast((e as Error).message, { tone: "error" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!info)
    return (
      <main className="mx-auto flex max-w-3xl justify-center px-5 py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );

  const s = info.settings;
  const save = async (next: EnrichSettings) => {
    setSaving(true);
    try {
      const updated = await api.putEnrichSettings(next);
      setInfo(updated);
      invalidateEnrichInfo(updated);
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const setSource = (key: SourceKey, patch: object) =>
    save({ ...s, sources: { ...s.sources, [key]: { ...s.sources[key], ...patch } } });

  const enabledCount = SOURCE_META.filter(
    (m) => s.sources[m.key].enabled && info.availability[m.key]?.available,
  ).length;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Enrichment settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        How “Enrich with AI” investigates an issue before rendering its verdict.
      </p>

      <div className="mt-6 flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
        <ShieldCheck className="size-5 shrink-0 text-success" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Everything below is read-only by construction.</strong>{" "}
          Agents never hold credentials: every external call goes through this app's local toolbox
          proxy, which only implements read operations and records each call in the run's action log.
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {(["fast", "deep"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => save({ ...s, mode })}
            disabled={saving}
            className={cn(
              "cursor-pointer rounded-xl border p-4 text-left transition-colors",
              s.mode === mode
                ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                : "border-border bg-card hover:bg-accent/40",
            )}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Zap className={cn("size-4", s.mode === mode ? "text-primary" : "text-muted-foreground")} />
              {mode === "fast" ? "Fast" : "Deep"}
              {s.mode === mode && <Check className="ml-auto size-4 text-primary" />}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {mode === "fast"
                ? "One Claude call over the issue text and comments. ~15–30s, no external access."
                : "Fanout of read-only scout agents over the sources below, run in parallel, synthesized into a structured report with an action log. Time ≈ slowest enabled scout + synthesis."}
            </p>
          </button>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Deep-mode sources
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Each enabled source adds a parallel scout. Estimated impact is per run; scouts run
        concurrently, so total ≈ slowest scout + ~15–30s synthesis.
        {enabledCount > 0 && (
          <>
            {" "}
            Currently enabled: {enabledCount} → <strong className="text-foreground">{`~45s–2min per issue`}</strong>.
          </>
        )}
      </p>

      <div className="mt-4 grid gap-3">
        {SOURCE_META.map((m) => {
          const src = s.sources[m.key];
          const avail = info.availability[m.key];
          return (
            <div
              key={m.key}
              className={cn(
                "rounded-xl border p-4",
                src.enabled && avail?.available ? "border-primary/30 bg-primary/[0.03]" : "border-border bg-card",
              )}
            >
              <div className="flex items-start gap-3">
                <button
                  role="switch"
                  aria-checked={src.enabled}
                  onClick={() => setSource(m.key, { enabled: !src.enabled })}
                  disabled={saving}
                  className={cn(
                    "relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors",
                    src.enabled ? "bg-primary" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
                      src.enabled ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{m.name}</span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      <Lock className="size-2.5" /> read-only
                    </span>
                    <span className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 font-mono text-[10px] text-info">
                      {m.estimate}
                    </span>
                    <span
                      className={cn(
                        "ml-auto inline-flex items-center gap-1 text-[11px]",
                        avail?.available ? "text-success" : "text-warning-foreground dark:text-warning",
                      )}
                      title={avail?.detail}
                    >
                      {avail?.available ? <Check className="size-3" /> : <TriangleAlert className="size-3" />}
                      {avail?.available ? "available" : avail?.detail}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.what}</p>

                  {m.key === "repo" && src.enabled && (
                    <div className="mt-3 grid gap-1.5">
                      {(s.sources.repo.paths ?? []).map((p, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                          <code className="flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-xs">{p}</code>
                          <Button
                            variant="ghost"
                            size="iconSm"
                            aria-label="Remove directory"
                            onClick={() =>
                              setSource("repo", { paths: s.sources.repo.paths.filter((_, j) => j !== i) })
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <input
                          value={newPath}
                          onChange={(e) => setNewPath(e.target.value)}
                          placeholder="~/Workplace/github.com/org/repo"
                          className="h-8 flex-1 rounded-md border border-input bg-surface px-2.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newPath.trim()) {
                              setSource("repo", { paths: [...(s.sources.repo.paths ?? []), newPath.trim()] });
                              setNewPath("");
                            }
                          }}
                        />
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={!newPath.trim()}
                          onClick={() => {
                            setSource("repo", { paths: [...(s.sources.repo.paths ?? []), newPath.trim()] });
                            setNewPath("");
                          }}
                        >
                          <Plus /> Add
                        </Button>
                      </div>
                    </div>
                  )}

                  {m.key === "datadog" && src.enabled && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Site</span>
                      <input
                        defaultValue={s.sources.datadog.site}
                        placeholder="datadoghq.com"
                        onBlur={(e) => setSource("datadog", { site: e.target.value.trim() })}
                        className="h-8 w-56 rounded-md border border-input bg-surface px-2.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
