// Thin fetch wrapper over the local Go API.
import type { Issue, Meta, Macro, Op, Comment, Report, SyncStatus, Enrichment } from "./types";

class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  }
  return body as T;
}

export const api = {
  meta: () => req<Meta>("/api/meta"),
  queue: (team: string, exclude: string[], limit = 25) => {
    const p = new URLSearchParams();
    if (team) p.set("team", team);
    if (exclude.length) p.set("exclude", exclude.join(","));
    p.set("limit", String(limit));
    return req<{ issues: Issue[] | null; remaining: number }>(`/api/queue?${p}`);
  },
  context: (id: string) => req<{ comments: Comment[] | null }>(`/api/issues/${id}/context`),
  apply: (id: string, ops: Op[], outcome: string, durationMs?: number) =>
    req<{ issue: Issue; activityId: number }>(`/api/issues/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({ ops, outcome, durationMs }),
    }),
  runMacro: (id: string, macroId: number, durationMs?: number) =>
    req<{ issue: Issue; activityId: number; macro: string }>(`/api/issues/${id}/macro/${macroId}`, {
      method: "POST",
      body: JSON.stringify({ durationMs }),
    }),
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
