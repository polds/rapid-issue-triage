// Shared types mirroring the Go server's JSON payloads.

export interface LabelChip {
  id: string;
  name: string;
  color: string;
}

export interface Enrichment {
  issueId: string;
  summary: string;
  verdict: "actionable" | "likely_obsolete" | "possibly_done" | "needs_info" | "duplicate_suspect";
  reasoning: string;
  confidence: number;
  model?: string;
  createdAt: string;
  report?: DeepReport | null;
  stale?: boolean;
}

export interface DeepReport {
  schemaVersion: number;
  verdict: Enrichment["verdict"];
  confidence: number;
  summary: string;
  reasoning: string;
  recommendation: string;
  evidence: { source: string; finding: string; link?: string }[];
  relatedIssues: { identifier: string; title: string; state: string; relation?: string; url?: string }[];
  relatedPRs: { repo: string; number: number; title: string; state: string; url?: string }[];
  sources?: Record<string, { status: string; elapsed: string; error?: string }>;
}

export type SourceKey = "repo" | "github" | "linear" | "datadog" | "gcloud";

export interface EnrichSettings {
  mode: "fast" | "deep";
  claudePath?: string;
  sources: {
    repo: { enabled: boolean; paths: string[] };
    github: { enabled: boolean };
    linear: { enabled: boolean };
    datadog: { enabled: boolean; site: string };
    gcloud: { enabled: boolean };
  };
}

export interface SourceAvail {
  available: boolean;
  detail: string;
}

export interface ClaudeAvail {
  available: boolean;
  command: string;
  path?: string;
  detail: string;
}

export interface SecretField {
  id: string;
  label: string;
  set: boolean;
  // "settings" (stored in sqlite) or "env", plus any provider-specific origin.
  source?: string;
  hint?: string;
}

export interface EnrichSettingsInfo {
  settings: EnrichSettings;
  availability: Record<SourceKey, SourceAvail>;
  deepReady?: boolean;
  claude?: ClaudeAvail;
  secrets?: Partial<Record<SourceKey, SecretField[]>>;
}

export interface EnrichRun {
  id: string;
  issueId: string;
  issueIdentifier: string;
  mode: string;
  status: "running" | "done" | "error" | "cancelled";
  report?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

// The per-event payload the enrichment stream sends. Its shape varies by
// `kind`, and the Go side adds agent-specific keys, so every field is optional
// and anything unlisted stays `unknown` — narrow it before use, don't widen the
// type back to `any`.
export interface EnrichPayload {
  scouts?: string[];
  state?: string;
  text?: string;
  tool?: string;
  args?: string[];
  input?: unknown;
  error?: string;
  [key: string]: unknown;
}

export interface EnrichEvent {
  id: number;
  runId: string;
  seq: number;
  agent: string;
  kind: string;
  payload: EnrichPayload;
  at: string;
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  teamId: string;
  stateId: string;
  assigneeId: string;
  projectId: string;
  cycleId: string;
  creatorName: string;
  priority: number;
  estimate: number | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  labels: LabelChip[];
  skipCount: number;
  snoozedUntil?: string;
  triagedAt?: string;
  enrichment?: Enrichment | null;
}

export interface Team { id: string; key: string; name: string }
export interface WorkflowState { id: string; teamId: string; name: string; type: string; color: string; position: number }
// parentId is the label group this label belongs to, if any. Linear label
// groups are mutually exclusive: only one child per group may be on an issue.
export interface Label { id: string; teamId: string; name: string; color: string; isGroup: number; parentId: string }

// LabelGroupConflict is one exclusive label group with more than one label
// landing on an issue. `resolvable` means replacing `existing` with `incoming`
// is unambiguous — true only when the action adds exactly one of the siblings.
export interface LabelGroupConflict {
  group: string;
  existing: string[];
  incoming: string[];
  resolvable: boolean;
}
export interface Project { id: string; name: string; state: string }
export interface Cycle { id: string; teamId: string; number: number; name: string; startsAt: string; endsAt: string }
export interface User { id: string; name: string; displayName: string; email: string; isMe: number }

export interface SyncStatus {
  state: "idle" | "syncing" | "error";
  lastSyncedAt?: string;
  lastError?: string;
  issueCount: number;
  stale: boolean;
  reindexing?: boolean;
}

export interface ViewFilter {
  teams: string[];
  excludeTeams: string[];
  labels: string[];
  excludeLabels: string[];
  priorities: number[];
  search: string;
}

export const EMPTY_FILTER: ViewFilter = {
  teams: [], excludeTeams: [], labels: [], excludeLabels: [], priorities: [], search: "",
};

export function filterIsEmpty(f: ViewFilter): boolean {
  return !f.teams.length && !f.excludeTeams.length && !f.labels.length &&
    !f.excludeLabels.length && !f.priorities.length && !f.search.trim();
}

export interface IndexFilterInfo {
  filter: Record<string, unknown>;
  default: Record<string, unknown>;
  overridden: boolean;
  recent: { filter: Record<string, unknown>; usedAt: string }[] | null;
  syncStatus: SyncStatus;
}

export interface Meta {
  teams: Team[];
  states: WorkflowState[];
  labels: Label[];
  projects: Project[];
  cycles: Cycle[];
  users: User[];
  sync: SyncStatus;
  teamCounts: Record<string, number>;
  aiEnabled: boolean;
  claude?: ClaudeAvail;
}

export type OpType =
  | "add_label" | "remove_label" | "set_state" | "set_estimate"
  | "set_project" | "set_cycle" | "set_assignee" | "add_comment" | "post_ai_report";

export interface Op {
  type: OpType;
  labelId?: string;
  labelName?: string;
  labelNames?: string[];
  stateId?: string;
  stateName?: string;
  stateType?: string;
  duplicateOfId?: string;
  estimate?: number;
  projectId?: string;
  cycleId?: string;
  assigneeId?: string;
  body?: string;
  clear?: boolean;
}

export interface Macro {
  id: number;
  name: string;
  keyBinding: string;
  outcome: "accepted" | "cancelled" | "done" | "custom";
  steps: Op[];
  position: number;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  user?: { name: string; displayName: string } | null;
}

export interface ActivityItem {
  id: number;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  kind: string;
  outcome: string;
  detail?: string;
  undone: boolean;
  durationMs: number | null;
  createdAt: string;
}

export interface Report {
  today: number;
  week: number;
  allTime: number;
  byDay: { date: string; count: number }[];
  streakDays: number;
  byOutcome: Record<string, number>;
  avgMs: number;
  fastestMs: number;
  recent: ActivityItem[];
}

export interface CustomView {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  modelName: string;
  filterData: Record<string, unknown>;
  team?: { id: string } | null;
}

export interface LinearSearchHit {
  id: string;
  identifier: string;
  title: string;
  state: string;
  updatedAt: string;
  url: string;
}
