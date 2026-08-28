// Enrichment settings: fast vs deep mode, per-source toggles with live
// availability probes, time-impact estimates, and the read-only guarantee
// spelled out. Claude path, MCP API keys, and a native folder picker live here.
import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { invalidateEnrichInfo } from "@/lib/enrichmode";
import { useTriage } from "@/lib/store";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import type { EnrichSettings, EnrichSettingsInfo, SecretField, SourceKey } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOURCE_META: {
  key: SourceKey;
  name: string;
  what: string;
  estimate: string;
}[] = [
  { key: "repo", name: "Repository access", what: "Reads (Read/Grep/Glob only) the directories you list to check whether referenced code still exists or already changed.", estimate: "+30–90s" },
  { key: "github", name: "GitHub", what: "Searches PRs and code via gh. Uses your gh login, or a personal access token set below. Read-only subcommands only.", estimate: "+30–90s" },
  { key: "linear", name: "Linear", what: "Searches Linear for duplicates and checks the state of referenced issues. Queries only.", estimate: "+20–60s" },
  { key: "datadog", name: "Datadog", what: "Searches logs and monitors to see whether the described problem still occurs. Read APIs only.", estimate: "+30–90s" },
  { key: "gcloud", name: "Google Cloud", what: "Runs gcloud restricted to list/describe/get-iam-policy read verbs to inspect referenced infrastructure. Uses your local gcloud login.", estimate: "+30–90s" },
];

export function SettingsPage() {
  const { toast } = useToast();
  const { reloadMeta } = useTriage();
  const [info, setInfo] = useState<EnrichSettingsInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [picking, setPicking] = useState(false);
  const [claudePathDraft, setClaudePathDraft] = useState("");
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    api
      .enrichSettings()
      .then((i) => {
        setInfo(i);
        setClaudePathDraft(i.settings.claudePath ?? "");
        if (i.claude && !i.claude.available) setAdvanced(true);
      })
      .catch((e) => toast((e as Error).message, { tone: "error" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!info)
    return (
      <main className="mx-auto flex max-w-3xl justify-center px-5 py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );

  const s = info.settings;
  const apply = (updated: EnrichSettingsInfo) => {
    setInfo(updated);
    invalidateEnrichInfo(updated);
    setClaudePathDraft(updated.settings.claudePath ?? "");
    void reloadMeta();
  };

  const save = async (next: EnrichSettings) => {
    setSaving(true);
    try {
      apply(await api.putEnrichSettings(next));
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const setSource = (key: SourceKey, patch: object) =>
    save({ ...s, sources: { ...s.sources, [key]: { ...s.sources[key], ...patch } } });

  const pickFolder = async () => {
    setPicking(true);
    try {
      const r = await api.pick("folder");
      if (r.canceled || !r.path) return;
      await setSource("repo", { paths: [...(s.sources.repo.paths ?? []), r.path] });
    } catch (e) {
      toast(`Folder picker: ${(e as Error).message}`, { tone: "error" });
    } finally {
      setPicking(false);
    }
  };

  const pickClaude = async () => {
    setPicking(true);
    try {
      const r = await api.pick("file");
      if (r.canceled || !r.path) return;
      setClaudePathDraft(r.path);
      await save({ ...s, claudePath: r.path });
    } catch (e) {
      toast(`File picker: ${(e as Error).message}`, { tone: "error" });
    } finally {
      setPicking(false);
    }
  };

  const saveSecret = async (key: string, value: string) => {
    setSaving(true);
    try {
      apply(await api.putSecret(key, value));
      toast(value.trim() ? "Key saved" : "Key cleared");
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = SOURCE_META.filter(
    (m) => s.sources[m.key].enabled && info.availability?.[m.key]?.available,
  ).length;

  const claude = info.claude;
  const claudeMissing = claude && !claude.available;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <h1 className="font-display text-2xl font-bold tracking-tight">Enrichment settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        How “Enrich with AI” investigates an issue before rendering its verdict.
      </p>

      {claudeMissing && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-foreground dark:text-warning" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-warning-foreground dark:text-warning">Claude Code CLI not found</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {claude.detail}. Enrichment needs the <code className="font-mono">claude</code> binary.
              Install Claude Code, or set the path under Advanced below.
            </p>
          </div>
        </div>
      )}

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
          const avail = info.availability?.[m.key];
          const secrets = info.secrets?.[m.key] ?? [];
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
                  className="mt-0.5 shrink-0 cursor-pointer"
                >
                  <span
                    className={cn(
                      "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
                      src.enabled ? "justify-end bg-primary" : "justify-start bg-muted",
                    )}
                  >
                    <span className="size-4 rounded-full bg-white shadow" />
                  </span>
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
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={newPath}
                          onChange={(e) => setNewPath(e.target.value)}
                          placeholder="~/Workplace/github.com/org/repo"
                          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-surface px-2.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                          disabled={picking}
                          onClick={pickFolder}
                          title="Open the system folder picker"
                        >
                          {picking ? <Loader2 className="animate-spin" /> : <FolderOpen />}
                          Browse
                        </Button>
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

                  {secrets.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      {secrets.map((f) => (
                        <SecretRow key={f.id} field={f} disabled={saving} onSave={saveSecret} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => setAdvanced((v) => !v)}
        className="mt-8 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {advanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Advanced
      </button>
      {advanced && (
        <div className="mt-3 rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold">Claude Code binary</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Default is <code className="font-mono">claude</code> on your PATH.
            {claude?.available && claude.path && (
              <> Currently resolved to <code className="font-mono">{claude.path}</code>.</>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={claudePathDraft}
              onChange={(e) => setClaudePathDraft(e.target.value)}
              placeholder="/usr/local/bin/claude"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-surface px-2.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter") save({ ...s, claudePath: claudePathDraft.trim() });
              }}
            />
            <Button variant="quiet" size="sm" disabled={picking} onClick={pickClaude}>
              {picking ? <Loader2 className="animate-spin" /> : <FolderOpen />}
              Browse
            </Button>
            <Button
              variant="quiet"
              size="sm"
              disabled={saving}
              onClick={() => save({ ...s, claudePath: claudePathDraft.trim() })}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}

function SecretRow({
  field,
  disabled,
  onSave,
}: {
  field: SecretField;
  disabled: boolean;
  onSave: (key: string, value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <KeyRound className="size-3 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">{field.label}</span>
        {field.set && (
          <span className="font-mono text-muted-foreground">
            {field.hint} · via {field.source === "settings" ? "Settings" : "environment"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field.set ? "paste to replace" : "paste key"}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-surface px-2.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              onSave(field.id, value);
              setValue("");
            }
          }}
        />
        <Button
          variant="quiet"
          size="sm"
          disabled={disabled || !value.trim()}
          onClick={() => {
            onSave(field.id, value);
            setValue("");
          }}
        >
          Save
        </Button>
        {field.set && field.source === "settings" && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onSave(field.id, "")}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
