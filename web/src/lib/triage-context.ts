// The triage context object, its accessor hook, and the deck types they
// carry. Kept apart from store.tsx so that module exports only components
// and stays fast-refresh friendly.
import { createContext, useContext } from "react";
import type {
  Enrichment,
  EnrichEvent,
  Issue,
  LabelGroupConflict,
  Macro,
  Meta,
  Op,
  SyncStatus,
  ViewFilter,
} from "./types";

export type CardStatus = "pending" | "skipped" | "snoozed" | "triaged";
export type Swipe = "left" | "right" | "down" | null;

export interface Card {
  issue: Issue;
  status: CardStatus;
  outcome?: string;
  activityId?: number;
}

export interface TriageCtx {
  meta: Meta | null;
  metaError: string | null;
  sync: SyncStatus | null;
  refreshSync: () => void;
  macros: Macro[];
  reloadMacros: () => Promise<void>;

  viewFilter: ViewFilter;
  setViewFilter: (f: ViewFilter) => void;

  cards: Card[];
  index: number;
  current: Card | null;
  remaining: number;
  loading: boolean;
  swipe: Swipe;
  busy: boolean;

  sessionTriaged: number;
  milestone: number;

  next: () => void;
  prev: () => void;
  skip: () => void;
  snooze: () => void;
  applyMacro: (m: Macro, duplicateOfId?: string, replaceGroupLabels?: boolean) => void;
  // Set when a macro needs the canonical issue before entering a
  // duplicate-type state; TriagePage renders the picker.
  duplicatePrompt: Macro | null;
  cancelDuplicatePrompt: () => void;
  // Set when an action would put two labels of one exclusive Linear label group
  // on the issue; TriagePage renders the replace-or-cancel prompt.
  labelPrompt: LabelPrompt | null;
  cancelLabelPrompt: () => void;
  applyOps: (ops: Op[], description: string, replaceGroupLabels?: boolean) => Promise<void>;
  undo: () => void;
  canUndo: boolean;
  enrich: () => Promise<void>;
  enriching: boolean;
  reloadMeta: () => Promise<void>;
  setIssueEnrichment: (issueId: string, e: Enrichment) => void;
  // Background deep-run tracking: notices feed the bell dropdown and toasts;
  // event buffers feed the live panel; focusIssue jumps back to a card.
  notices: EnrichNotice[];
  markNoticesRead: () => void;
  clearDoneNotices: () => void;
  activeRunFor: (issueId: string) => string | null;
  getRunEvents: (runId: string) => EnrichEvent[];
  eventsTick: number;
  focusIssue: (issueId: string) => Promise<boolean>;
}

// LabelPrompt is one pending label-group clash: what the user asked for, the
// groups that clash, and the callback that re-runs the action with the
// pre-existing sibling replaced.
export interface LabelPrompt {
  action: string;
  conflicts: LabelGroupConflict[];
  rerun: () => void;
}

export interface EnrichNotice {
  runId: string;
  issueId: string;
  identifier: string;
  status: "running" | "done" | "error";
  verdict?: string;
  error?: string;
  at: string;
  read: boolean;
}

export const TriageContext = createContext<TriageCtx | null>(null);

export function useTriage(): TriageCtx {
  const v = useContext(TriageContext);
  if (!v) throw new Error("useTriage outside provider");
  return v;
}
