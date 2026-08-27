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
export interface Label { id: string; teamId: string; name: string; color: string; isGroup: number }
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
}

export type OpType =
  | "add_label" | "remove_label" | "set_state" | "set_estimate"
  | "set_project" | "set_cycle" | "set_assignee";

export interface Op {
  type: OpType;
  labelId?: string;
  labelName?: string;
  stateId?: string;
  stateName?: string;
  stateType?: string;
  estimate?: number;
  projectId?: string;
  cycleId?: string;
  assigneeId?: string;
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
