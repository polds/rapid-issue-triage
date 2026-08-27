// Global app state: metadata, macro list, the card deck, and every triage
// action. Actions are optimistic — the card animates away immediately while
// the Linear call runs; failures roll the card back with an error toast.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import { useToast } from "@/components/ui/toast";
import { EMPTY_FILTER, type Enrichment, type Issue, type Macro, type Meta, type Op, type SyncStatus, type ViewFilter } from "./types";

export type CardStatus = "pending" | "skipped" | "snoozed" | "triaged";
export type Swipe = "left" | "right" | "down" | null;

export interface Card {
  issue: Issue;
  status: CardStatus;
  outcome?: string;
  activityId?: number;
}

interface TriageCtx {
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
  applyMacro: (m: Macro) => void;
  applyOps: (ops: Op[], description: string) => Promise<void>;
  undo: () => void;
  canUndo: boolean;
  enrich: () => Promise<void>;
  enriching: boolean;
  setIssueEnrichment: (issueId: string, e: Enrichment) => void;
}

const Ctx = createContext<TriageCtx | null>(null);

export function useTriage(): TriageCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTriage outside provider");
  return v;
}

const BATCH = 25;
const SWIPE_MS = 300;

export function TriageProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [viewFilter, setViewFilterState] = useState<ViewFilter>(() => {
    try {
      const raw = window.localStorage.getItem("rt-viewfilter");
      return raw ? { ...EMPTY_FILTER, ...JSON.parse(raw) } : EMPTY_FILTER;
    } catch {
      return EMPTY_FILTER;
    }
  });


  const [cards, setCards] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swipe, setSwipe] = useState<Swipe>(null);
  const [busy, setBusy] = useState(false);
  const [sessionTriaged, setSessionTriaged] = useState(0);
  const [milestone, setMilestone] = useState(0);
  const [enriching, setEnriching] = useState(false);

  // Undo stack of activity ids in the order actions happened this session.
  const undoStack = useRef<{ activityId: number; issueId: string; wasTriage: boolean }[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const viewStart = useRef(Date.now());
  const fetching = useRef(false);

  const loadMeta = useCallback(async () => {
    try {
      const m = await api.meta();
      setMeta(m);
      setSync(m.sync);
      setMetaError(null);
    } catch (e) {
      setMetaError((e as Error).message);
    }
  }, []);

  const reloadMacros = useCallback(async () => {
    try {
      const r = await api.macros();
      setMacros(r.macros ?? []);
    } catch (e) {
      toast(`Failed to load macros: ${(e as Error).message}`, { tone: "error" });
    }
  }, [toast]);

  // Fetch a batch of queue cards, excluding everything already in the deck.
  const fetchMore = useCallback(
    async (reset: boolean) => {
      if (fetching.current) return;
      fetching.current = true;
      try {
        const exclude = reset ? [] : cardsRef.current.map((c) => c.issue.id);
        const r = await api.queue(viewFilter, exclude, BATCH);
        const fresh = (r.issues ?? []).map((issue) => ({ issue, status: "pending" as const }));
        setRemaining(r.remaining);
        setCards((prev) => {
          if (reset) return fresh;
          const seen = new Set(prev.map((c) => c.issue.id));
          return [...prev, ...fresh.filter((c) => !seen.has(c.issue.id))];
        });
        if (reset) setIndex(0);
      } catch (e) {
        toast(`Queue load failed: ${(e as Error).message}`, { tone: "error" });
      } finally {
        fetching.current = false;
        setLoading(false);
      }
    },
    [viewFilter, toast],
  );

  // Keep a ref of cards for exclude computation without re-creating callbacks.
  const cardsRef = useRef<Card[]>([]);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // Initial loads.
  useEffect(() => {
    loadMeta();
    reloadMacros();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewFilter]);

  // Poll sync status; refresh meta + counts when a sync completes.
  const prevSyncState = useRef<string>("");
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const st = await api.syncStatus();
        setSync(st);
        if (prevSyncState.current === "syncing" && st.state === "idle") {
          loadMeta();
          if (cardsRef.current.length === 0) fetchMore(true);
        }
        prevSyncState.current = st.state;
      } catch {
        /* server briefly unavailable; keep last status */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [loadMeta, fetchMore]);

  // Buffer refill: keep at least 8 pending cards ahead of the cursor.
  useEffect(() => {
    const ahead = cards.slice(index).filter((c) => c.status === "pending").length;
    if (!loading && ahead < 8 && cards.length < remaining) fetchMore(false);
  }, [cards, index, remaining, loading, fetchMore]);

  // Reset the per-card timer whenever the visible card changes.
  useEffect(() => {
    viewStart.current = Date.now();
  }, [index, cards.length]);

  const current = cards[index] ?? null;

  const setViewFilter = useCallback((f: ViewFilter) => {
    window.localStorage.setItem("rt-viewfilter", JSON.stringify(f));
    setViewFilterState(f);
  }, []);

  const advance = useCallback(() => {
    setIndex((i) => Math.min(i + 1, Math.max(cardsRef.current.length - 1, 0)));
  }, []);

  const next = useCallback(() => advance(), [advance]);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  const pushUndo = useCallback((activityId: number, issueId: string, wasTriage: boolean) => {
    undoStack.current.push({ activityId, issueId, wasTriage });
    setCanUndo(true);
  }, []);

  const updateCard = useCallback((issueId: string, patch: Partial<Card>) => {
    setCards((prev) => prev.map((c) => (c.issue.id === issueId ? { ...c, ...patch } : c)));
  }, []);

  const duration = useCallback(() => Date.now() - viewStart.current, []);

  // Animate the card away, then advance. The API call runs concurrently.
  const swipeAway = useCallback(
    (dir: Swipe, run: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setSwipe(dir);
      const animDone = new Promise((r) => setTimeout(r, SWIPE_MS));
      run()
        .then(async () => {
          await animDone;
          setSwipe(null);
          advance();
        })
        .catch(async (e) => {
          await animDone;
          setSwipe(null);
          toast(`Action failed: ${(e as Error).message}`, { tone: "error" });
        })
        .finally(() => setBusy(false));
    },
    [busy, advance, toast],
  );

  const skip = useCallback(() => {
    const card = current;
    if (!card || card.status !== "pending") return;
    const d = duration();
    swipeAway("left", async () => {
      const r = await api.skip(card.issue.id, d);
      updateCard(card.issue.id, { status: "skipped", outcome: "skipped", activityId: r.activityId });
      pushUndo(r.activityId, card.issue.id, false);
      toast(`Skipped ${card.issue.identifier}`, { onUndo: () => undoRef.current() });
    });
  }, [current, duration, swipeAway, updateCard, pushUndo, toast]);

  const snooze = useCallback(() => {
    const card = current;
    if (!card || card.status !== "pending") return;
    const d = duration();
    swipeAway("down", async () => {
      const r = await api.snooze(card.issue.id, 24 * 7, d);
      updateCard(card.issue.id, { status: "snoozed", outcome: "snoozed", activityId: r.activityId });
      pushUndo(r.activityId, card.issue.id, false);
      toast(`Snoozed ${card.issue.identifier} for 7 days`, { onUndo: () => undoRef.current() });
    });
  }, [current, duration, swipeAway, updateCard, pushUndo, toast]);

  const applyMacro = useCallback(
    (m: Macro) => {
      const card = current;
      if (!card || card.status !== "pending") return;
      const d = duration();
      swipeAway("right", async () => {
        const r = await api.runMacro(card.issue.id, m.id, d);
        updateCard(card.issue.id, {
          status: "triaged",
          outcome: m.outcome,
          activityId: r.activityId,
          issue: r.issue,
        });
        pushUndo(r.activityId, card.issue.id, true);
        setSessionTriaged((n) => {
          const v = n + 1;
          if (v % 10 === 0) setMilestone(v);
          return v;
        });
        setRemaining((n) => Math.max(0, n - 1));
        toast(`${m.name} → ${card.issue.identifier}`, { onUndo: () => undoRef.current() });
      });
    },
    [current, duration, swipeAway, updateCard, pushUndo, toast],
  );

  // Quick edits: apply ops in place without advancing the deck.
  const applyOps = useCallback(
    async (ops: Op[], description: string) => {
      const card = current;
      if (!card) return;
      try {
        const r = await api.apply(card.issue.id, ops, "edited", duration());
        updateCard(card.issue.id, { issue: r.issue, activityId: r.activityId });
        pushUndo(r.activityId, card.issue.id, false);
        toast(`${description} · ${card.issue.identifier}`, { onUndo: () => undoRef.current() });
      } catch (e) {
        toast(`Edit failed: ${(e as Error).message}`, { tone: "error" });
      }
    },
    [current, duration, updateCard, pushUndo, toast],
  );

  const undo = useCallback(() => {
    const last = undoStack.current.pop();
    setCanUndo(undoStack.current.length > 0);
    if (!last) return;
    api
      .undo(last.activityId)
      .then((r) => {
        setCards((prev) => {
          const idx = prev.findIndex((c) => c.issue.id === last.issueId);
          if (idx < 0) return prev;
          const copy = [...prev];
          copy[idx] = {
            ...copy[idx],
            status: "pending",
            outcome: undefined,
            issue: r.issue ?? copy[idx].issue,
          };
          // Jump back to the restored card.
          setIndex(idx);
          return copy;
        });
        if (last.wasTriage) {
          setSessionTriaged((n) => Math.max(0, n - 1));
          setRemaining((n) => n + 1);
        }
        toast("Undone");
      })
      .catch((e) => toast(`Undo failed: ${(e as Error).message}`, { tone: "error" }));
  }, [toast]);

  // Stable ref so toasts created before `undo` re-renders still work.
  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  const enrich = useCallback(async () => {
    const card = current;
    if (!card || enriching) return;
    setEnriching(true);
    try {
      const r = await api.enrich(card.issue.id);
      updateCard(card.issue.id, {
        issue: { ...card.issue, enrichment: r.enrichment as Enrichment },
      });
    } catch (e) {
      toast(`Enrichment failed: ${(e as Error).message}`, { tone: "error" });
    } finally {
      setEnriching(false);
    }
  }, [current, enriching, updateCard, toast]);

  const setIssueEnrichment = useCallback(
    (issueId: string, e: Enrichment) => {
      setCards((prev) =>
        prev.map((c) => (c.issue.id === issueId ? { ...c, issue: { ...c.issue, enrichment: e } } : c)),
      );
    },
    [],
  );

  const refreshSync = useCallback(() => {
    api.syncRefresh().then(() => {
      setSync((s) => (s ? { ...s, state: "syncing" } : s));
      prevSyncState.current = "syncing";
    });
  }, []);

  const value = useMemo<TriageCtx>(
    () => ({
      meta, metaError, sync, refreshSync, macros, reloadMacros,
      viewFilter, setViewFilter,
      cards, index, current, remaining, loading, swipe, busy,
      sessionTriaged, milestone,
      next, prev, skip, snooze, applyMacro, applyOps, undo, canUndo, enrich, enriching,
      setIssueEnrichment,
    }),
    [
      meta, metaError, sync, refreshSync, macros, reloadMacros, viewFilter, setViewFilter,
      cards, index, current, remaining, loading, swipe, busy, sessionTriaged, milestone,
      next, prev, skip, snooze, applyMacro, applyOps, undo, canUndo, enrich, enriching,
      setIssueEnrichment,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
