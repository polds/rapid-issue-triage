// Thin fetch wrapper over the local Go API.
import type { Issue, Meta, Macro, Op, Comment, Report, SyncStatus, Enrichment, ViewFilter, IndexFilterInfo, CustomView, EnrichSettings, EnrichSettingsInfo, EnrichRun, LinearSearchHit } from "./types";

class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// Coerce a server-supplied value to the string the UI renders: primitives
// stringify as before, and a missing or non-primitive field becomes "" rather
// than the "[object Object]" a bare String() would have produced.
function asString(v: unknown): string {
  if (typeof v === "string") return v;
  return typeof v === "number" || typeof v === "boolean" ? String(v) : "";
}

// A decoded response is `unknown` until something checks it. The `as T` below
// is the one place the server's shape is trusted; keeping the body out of `any`
// is what stops that trust silently leaking into every caller.
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = isRecord(body) && typeof body.error === "string" ? body.error : undefined;
    throw new ApiError(err ?? `HTTP ${res.status}`, res.status);
  }
  return body as T;
}

export const api = {
  meta: () => req<Meta>("/api/meta"),
  queue: (f: ViewFilter, exclude: string[], limit = 25) => {
    const p = new URLSearchParams();
    if (f.teams.length) p.set("teams", f.teams.join(","));
    if (f.excludeTeams.length) p.set("excludeTeams", f.excludeTeams.join(","));
    if (f.labels.length) p.set("labels", f.labels.join(","));
    if (f.excludeLabels.length) p.set("excludeLabels", f.excludeLabels.join(","));
    if (f.priorities.length) p.set("priorities", f.priorities.join(","));
    if (f.search.trim()) p.set("search", f.search.trim());
    if (exclude.length) p.set("exclude", exclude.join(","));
    p.set("limit", String(limit));
    return req<{ issues: Issue[] | null; remaining: number }>(`/api/queue?${p}`);
  },
  views: () => req<{ views: CustomView[] | null }>("/api/views"),
  getIndexFilter: () => req<IndexFilterInfo>("/api/filter"),
  putIndexFilter: (filter: Record<string, unknown>) =>
    req<{ ok: boolean }>("/api/filter", { method: "PUT", body: JSON.stringify({ filter }) }),
  resetIndexFilter: () => req<{ ok: boolean }>("/api/filter", { method: "DELETE" }),
  getIssue: (id: string) => req<{ issue: Issue }>(`/api/issues/${id}`),
  context: (id: string) => req<{ comments: Comment[] | null }>(`/api/issues/${id}/context`),
  apply: (id: string, ops: Op[], outcome: string, durationMs?: number) =>
    req<{ issue: Issue; activityId: number }>(`/api/issues/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({ ops, outcome, durationMs }),
    }),
  runMacro: (id: string, macroId: number, durationMs?: number, duplicateOfId?: string) =>
    req<{ issue: Issue; activityId: number; macro: string }>(`/api/issues/${id}/macro/${macroId}`, {
      method: "POST",
      body: JSON.stringify({ durationMs, duplicateOfId }),
    }),
  linearSearch: async (q: string): Promise<LinearSearchHit[]> => {
    const r = await req<unknown>(`/api/linear/search?q=${encodeURIComponent(q)}`);
    const issues: unknown = isRecord(r) ? r.issues : undefined;
    const raw: unknown[] = Array.isArray(issues) ? issues : isRecord(r) && r.identifier ? [r] : [];
    // Normalize: an identifier lookup and a text search take different code
    // paths in Linear, so coerce every field to the primitive the UI renders.
    return raw
      .filter(isRecord)
      .filter((h) => h.id && h.identifier)
      .map((h) => ({
        id: asString(h.id),
        identifier: asString(h.identifier),
        title: asString(h.title),
        state: typeof h.state === "string" ? h.state : isRecord(h.state) ? asString(h.state.name) : "",
        updatedAt: asString(h.updatedAt),
        url: asString(h.url),
      }));
  },
  skip: (id: string, durationMs?: number) =>
    req<{ activityId: number }>(`/api/issues/${id}/skip`, {
      method: "POST",
      body: JSON.stringify({ durationMs }),
    }),
  snooze: (id: string, hours: number, durationMs?: number) =>
    req<{ activityId: number }>(`/api/issues/${id}/snooze`, {
      method: "POST",
      body: JSON.stringify({ hours, durationMs }),
    }),
  enrich: (id: string) => req<{ enrichment: Enrichment }>(`/api/issues/${id}/enrich`, { method: "POST" }),
  deepEnrich: (id: string) => req<{ runId: string }>(`/api/issues/${id}/enrich/deep`, { method: "POST" }),
  latestRun: (issueId: string) => req<{ run: EnrichRun | null }>(`/api/issues/${issueId}/runs/latest`),
  getRun: (runId: string) => req<EnrichRun>(`/api/enrich/runs/${runId}`),
  enrichSettings: () => req<EnrichSettingsInfo>("/api/enrich/settings"),
  putEnrichSettings: (s: EnrichSettings) =>
    req<EnrichSettingsInfo>("/api/enrich/settings", { method: "PUT", body: JSON.stringify(s) }),
  putSecret: (key: string, value: string) =>
    req<EnrichSettingsInfo>("/api/secrets", { method: "PUT", body: JSON.stringify({ key, value }) }),
  pick: (kind: "folder" | "file") =>
    req<{ path: string; canceled?: boolean }>("/api/pick", { method: "POST", body: JSON.stringify({ kind }) }),
  undo: (activityId: number) =>
    req<{ ok: boolean; issue?: Issue }>(`/api/activity/${activityId}/undo`, { method: "POST" }),
  macros: () => req<{ macros: Macro[] }>("/api/macros"),
  createMacro: (m: Omit<Macro, "id">) =>
    req<Macro>("/api/macros", { method: "POST", body: JSON.stringify(m) }),
  updateMacro: (m: Macro) =>
    req<Macro>(`/api/macros/${m.id}`, { method: "PUT", body: JSON.stringify(m) }),
  deleteMacro: (id: number) => req<{ ok: boolean }>(`/api/macros/${id}`, { method: "DELETE" }),
  report: () => req<Report>("/api/report"),
  syncStatus: () => req<SyncStatus>("/api/sync/status"),
  syncRefresh: () => req<{ status: string }>("/api/sync/refresh", { method: "POST" }),
};
