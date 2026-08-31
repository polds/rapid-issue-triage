// Global app state: metadata, macro list, the card deck, and every triage
// action. Actions are optimistic — the card animates away immediately while
// the Linear call runs; failures roll the card back with an error toast.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "./api";
import { getEnrichInfo } from "./enrichmode";
import { labelGroupConflicts } from "./labelgroups";
import { useToast } from "@/components/ui/use-toast";
import { EMPTY_FILTER, type DeepReport, type Enrichment, type EnrichEvent, type Macro, type Meta, type Op, type SyncStatus, type VersionInfo, type ViewFilter } from "./types";
import {
  TriageContext,
  type Card,
  type CardStatus,
  type EnrichNotice,
  type LabelPrompt,
  type Swipe,
  type TriageCtx,
} from "./triage-context";

// The context object, its hook and the shared deck types live in
// ./triage-context so this module exports only components (react-refresh).
export type { Card, CardStatus, EnrichNotice, LabelPrompt, Swipe };

const BATCH = 25;
const SWIPE_MS = 300;

export function TriageProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [viewFilter, setViewFilterState] = useState<ViewFilter>(() => {
    try {
      const raw = window.localStorage.getItem("rt-viewfilter");
      return raw ? { ...EMPTY_FILTER, ...(JSON.parse(raw) as Partial<ViewFilter>) } : EMPTY_FILTER;
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
  const [duplicatePrompt, setDuplicatePrompt] = useState<Macro | null>(null);
  const [labelPrompt, setLabelPrompt] = useState<LabelPrompt | null>(null);
  const [notices, setNotices] = useState<EnrichNotice[]>([]);
  const [eventsTick, setEventsTick] = useState(0);
  const runEvents = useRef<Map<string, EnrichEvent[]>>(new Map());
  const watchers = useRef<Map<string, EventSource>>(new Map());

  // Undo stack of activity ids in the order actions happened this session.
  const undoStack = useRef<{ activityId: number; issueId: string; wasTriage: boolean }[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  // Stamped by the card-change effect below (which also runs on mount) rather
  // than during render, so the timer does not depend on when React renders.
  const viewStart = useRef(0);
  const fetching = useRef(false);

  // Latest-value refs, for callbacks that must not re-create when the value
  // they mirror changes. Declared up front so every reader below binds to the
  // same ref; each is kept in sync by an effect next to the value it mirrors.
  const cardsRef = useRef<Card[]>([]);
  const indexRef = useRef(0);
  const undoRef = useRef<() => void>(() => {});
  // Retry handles for the label-group prompt. The prompt's "Replace" re-runs
  // the very action that raised it, which would otherwise make each callback
  // reference itself inside its own initializer.
  const applyMacroRef = useRef<(m: Macro, duplicateOfId?: string, replaceGroupLabels?: boolean) => void>(() => {});
  const applyOpsRef = useRef<(ops: Op[], description: string, replaceGroupLabels?: boolean) => void>(() => {});
  const focusIssueRef = useRef<(issueId: string) => Promise<boolean>>(() => Promise.resolve(false));

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

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Initial loads. Both are fire-and-forget fetches whose state updates land in
  // the promise continuation, not in the effect body — the `void (async …)()`
  // wrapper says so, and keeps them running concurrently as before.
  useEffect(() => {
    void (async () => {
      await Promise.all([loadMeta(), reloadMacros()]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A filter change refetches the deck. `loading` is raised by setViewFilter,
  // where the change originates, so this effect only kicks off the request.
  useEffect(() => {
    void (async () => {
      await fetchMore(true);
    })();
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
          void loadMeta();
          if (cardsRef.current.length === 0) void fetchMore(true);
        }
        prevSyncState.current = st.state;
      } catch {
        /* server briefly unavailable; keep last status */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [loadMeta, fetchMore]);

  // Read the build stamp and the update state. The server owns the actual
  // check (internal/update, on its own daily timer); this only re-reads the
  // snapshot, so an hourly poll is plenty and costs one local request.
  useEffect(() => {
    const read = () => api.version().then(setVersion).catch(() => {
      /* server briefly unavailable; keep the last stamp */
    });
    void read();
    const t = setInterval(() => void read(), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // "Check for updates" in Settings. The server collapses a concurrent check
  // into the one already running, so this cannot fan out.
  const checkForUpdate = useCallback(async () => {
    try {
      setVersion(await api.checkForUpdate());
    } catch (e) {
      toast(`Update check failed: ${(e as Error).message}`, { tone: "error" });
    }
  }, [toast]);

  // Buffer refill: keep at least 8 pending cards ahead of the cursor.
  useEffect(() => {
    const ahead = cards.slice(index).filter((c) => c.status === "pending").length;
    if (!loading && ahead < 8 && cards.length < remaining) void fetchMore(false);
  }, [cards, index, remaining, loading, fetchMore]);

  // Reset the per-card timer whenever the visible card changes.
  useEffect(() => {
    viewStart.current = Date.now();
  }, [index, cards.length]);

  const current = cards[index] ?? null;

  const setViewFilter = useCallback((f: ViewFilter) => {
    window.localStorage.setItem("rt-viewfilter", JSON.stringify(f));
    // The deck is stale the moment the filter changes; raise `loading` here
    // rather than in the refetch effect, so both land in one render.
    setLoading(true);
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

  // Declared here, above startWatcher, because startWatcher closes over it:
  // a forward reference stops React Compiler from preserving this memo.
  const setIssueEnrichment = useCallback(
    (issueId: string, e: Enrichment) => {
      setCards((prev) =>
        prev.map((c) => (c.issue.id === issueId ? { ...c, issue: { ...c.issue, enrichment: e } } : c)),
      );
    },
    [],
  );

  const duration = useCallback(() => (viewStart.current ? Date.now() - viewStart.current : 0), []);

  // Animate the card away, then advance. The API call runs concurrently.
  // onError lets a caller claim a failure it can present better than a toast —
  // a label-group clash raises its own prompt. Returning true suppresses the
  // toast; the card still rolls back either way.
  const swipeAway = useCallback(
    (dir: Swipe, run: () => Promise<void>, onError?: (e: unknown) => boolean) => {
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
          if (onError?.(e)) return;
          toast(`Action failed: ${(e as Error).message}`, { tone: "error" });
        })
        .finally(() => setBusy(false));
    },
    [busy, advance, toast],
  );

  // retireGoneCard claims the one failure that is not a failure: the deck is a
  // snapshot, and the background sync deletes issues that leave the index
  // filter, so a card can outlive its row. Skip and snooze are local
  // bookkeeping on that row — with it gone there is nothing to record and
  // nothing to undo. Rolling the card back would strand the user on a card no
  // keystroke can ever clear, so retire it and move on instead.
  const retireGoneCard = useCallback(
    (e: unknown, issue: { id: string; identifier: string }) => {
      if (!(e instanceof ApiError) || e.code !== "issue_gone") return false;
      updateCard(issue.id, { status: "gone", outcome: "left the index" });
      advance();
      // Toasts truncate at one line, so this says only what the user needs:
      // the card is gone and their keystroke was not the reason.
      toast(`${issue.identifier} left the index — triaged or closed`);
      return true;
    },
    [updateCard, advance, toast],
  );

  const skip = useCallback(() => {
    const card = current;
    if (!card || card.status !== "pending") return;
    const d = duration();
    swipeAway(
      "left",
      async () => {
        const r = await api.skip(card.issue.id, d);
        updateCard(card.issue.id, { status: "skipped", outcome: "skipped", activityId: r.activityId });
        pushUndo(r.activityId, card.issue.id, false);
        toast(`Skipped ${card.issue.identifier}`, { onUndo: () => undoRef.current() });
      },
      (e) => retireGoneCard(e, card.issue),
    );
  }, [current, duration, swipeAway, updateCard, pushUndo, toast, retireGoneCard]);

  const snooze = useCallback(() => {
    const card = current;
    if (!card || card.status !== "pending") return;
    const d = duration();
    swipeAway(
      "down",
      async () => {
        const r = await api.snooze(card.issue.id, 24 * 7, d);
        updateCard(card.issue.id, { status: "snoozed", outcome: "snoozed", activityId: r.activityId });
        pushUndo(r.activityId, card.issue.id, false);
        toast(`Snoozed ${card.issue.identifier} for 7 days`, { onUndo: () => undoRef.current() });
      },
      (e) => retireGoneCard(e, card.issue),
    );
  }, [current, duration, swipeAway, updateCard, pushUndo, toast, retireGoneCard]);

  // labelClash: would these ops put two labels of one exclusive Linear group on
  // the issue? Checked against synced metadata before the request goes out, so
  // the prompt appears without a wasted round trip. The server re-checks.
  const labelClash = useCallback(
    (ops: Op[], issue: { teamId: string; labels: { id: string }[] }) => {
      if (!meta) return [];
      return labelGroupConflicts(ops, { teamId: issue.teamId, labels: issue.labels }, meta.labels);
    },
    [meta],
  );

  // raiseLabelPrompt claims a server-reported clash — the case pre-flight
  // missed because the local label index predates the group. Returns whether
  // it took ownership of the error.
  const raiseLabelPrompt = useCallback(
    (e: unknown, action: string, rerun: () => void) => {
      if (!(e instanceof ApiError) || e.code !== "label_group_conflict" || !e.conflicts) return false;
      setLabelPrompt({ action, conflicts: e.conflicts, rerun });
      return true;
    },
    [],
  );

  // needsDuplicateOf: does this macro move the issue into a duplicate-type
  // state? (Linear requires the canonical issue for that.)
  const needsDuplicateOf = useCallback(
    (m: Macro, teamId: string) => {
      const states = meta?.states ?? [];
      return m.steps.some((st) => {
        if (st.type !== "set_state") return false;
        if (st.stateType === "duplicate") return true;
        if (st.stateId) return states.find((x) => x.id === st.stateId)?.type === "duplicate";
        if (st.stateName)
          return (
            states.find((x) => x.teamId === teamId && x.name.toLowerCase() === st.stateName!.toLowerCase())?.type ===
            "duplicate"
          );
        return false;
      });
    },
    [meta],
  );

  const applyMacro = useCallback(
    (m: Macro, duplicateOfId?: string, replaceGroupLabels?: boolean) => {
      const card = current;
      if (!card || card.status !== "pending") return;
      if (!duplicateOfId && needsDuplicateOf(m, card.issue.teamId)) {
        setDuplicatePrompt(m);
        return;
      }
      setDuplicatePrompt(null);
      if (!replaceGroupLabels) {
        const conflicts = labelClash(m.steps, card.issue);
        if (conflicts.length) {
          setLabelPrompt({ action: m.name, conflicts, rerun: () => applyMacroRef.current(m, duplicateOfId, true) });
          return;
        }
      }
      setLabelPrompt(null);
      const d = duration();
      swipeAway("right", async () => {
        const r = await api.runMacro(card.issue.id, m.id, d, duplicateOfId, replaceGroupLabels);
        updateCard(card.issue.id, {
          status: "triaged",
          outcome: m.outcome,
          activityId: r.activityId,
          issue: { ...r.issue, enrichment: r.issue.enrichment ?? card.issue.enrichment },
        });
        pushUndo(r.activityId, card.issue.id, true);
        setSessionTriaged((n) => {
          const v = n + 1;
          if (v % 10 === 0) setMilestone(v);
          return v;
        });
        setRemaining((n) => Math.max(0, n - 1));
        toast(`${m.name} → ${card.issue.identifier}`, { onUndo: () => undoRef.current() });
      }, (e) => raiseLabelPrompt(e, m.name, () => applyMacroRef.current(m, duplicateOfId, true)));
    },
    [current, duration, swipeAway, updateCard, pushUndo, toast, needsDuplicateOf, labelClash, raiseLabelPrompt],
  );

  const cancelDuplicatePrompt = useCallback(() => setDuplicatePrompt(null), []);
  const cancelLabelPrompt = useCallback(() => setLabelPrompt(null), []);

  // Quick edits: apply ops in place without advancing the deck.
  const applyOps = useCallback(
    async (ops: Op[], description: string, replaceGroupLabels?: boolean) => {
      const card = current;
      if (!card) return;
      if (!replaceGroupLabels) {
        const conflicts = labelClash(ops, card.issue);
        if (conflicts.length) {
          setLabelPrompt({
            action: description,
            conflicts,
            rerun: () => applyOpsRef.current(ops, description, true),
          });
          return;
        }
      }
      setLabelPrompt(null);
      try {
        const r = await api.apply(card.issue.id, ops, "edited", duration(), replaceGroupLabels);
        updateCard(card.issue.id, {
          issue: { ...r.issue, enrichment: r.issue.enrichment ?? card.issue.enrichment },
          activityId: r.activityId,
        });
        pushUndo(r.activityId, card.issue.id, false);
        toast(`${description} · ${card.issue.identifier}`, { onUndo: () => undoRef.current() });
      } catch (e) {
        if (raiseLabelPrompt(e, description, () => applyOpsRef.current(ops, description, true))) return;
        toast(`Edit failed: ${(e as Error).message}`, { tone: "error" });
      }
    },
    [current, duration, updateCard, pushUndo, toast, labelClash, raiseLabelPrompt],
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
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  useEffect(() => {
    applyMacroRef.current = applyMacro;
    applyOpsRef.current = (ops, description, replace) => void applyOps(ops, description, replace);
  }, [applyMacro, applyOps]);

  // startWatcher owns the run's SSE for its whole life, independent of which
  // card is on screen — enrichments continue and notify in the background.
  const startWatcher = useCallback(
    (runId: string, issueId: string, identifier: string) => {
      setNotices((n) => [
        { runId, issueId, identifier, status: "running", at: new Date().toISOString(), read: false },
        ...n,
      ]);
      runEvents.current.set(runId, []);
      const es = new EventSource(`/api/enrich/runs/${runId}/events`);
      watchers.current.set(runId, es);

      const finish = (status: "done" | "error", patch: Partial<EnrichNotice>) => {
        es.close();
        watchers.current.delete(runId);
        setNotices((n) =>
          n.map((x) => (x.runId === runId ? { ...x, ...patch, status, read: false, at: new Date().toISOString() } : x)),
        );
      };

      es.onmessage = (m: MessageEvent<string>) => {
        let ev: EnrichEvent;
        try {
          ev = JSON.parse(m.data) as EnrichEvent;
        } catch {
          return;
        }
        const buf = runEvents.current.get(runId);
        if (buf && (buf.length === 0 || ev.seq > buf[buf.length - 1].seq)) {
          buf.push(ev);
          setEventsTick((t) => t + 1);
        }
        if (ev.agent !== "orchestrator") return;
        if (ev.kind === "error") {
          const msg = String(ev.payload?.error ?? "enrichment failed");
          finish("error", { error: msg });
          toast(`Enrichment failed: ${identifier} — ${msg}`, { tone: "error" });
        } else if (ev.kind === "status" && ev.payload?.state === "done") {
          void api.latestRun(issueId).then((r) => {
            let verdict: string | undefined;
            if (r.run?.report) {
              try {
                const report = JSON.parse(r.run.report) as DeepReport;
                verdict = report.verdict;
                setIssueEnrichment(issueId, {
                  issueId,
                  summary: report.summary,
                  verdict: report.verdict,
                  reasoning: report.reasoning,
                  confidence: report.confidence,
                  createdAt: new Date().toISOString(),
                  report,
                });
              } catch {
                /* report unparseable; leave card as-is */
              }
            }
            finish("done", { verdict });
            toast(`Enrichment finished: ${identifier}`, {
              action: {
                label: "View",
                onClick: () => {
                  // Jump works from any page: hash-route back to triage first.
                  window.location.hash = "/";
                  void focusIssueRef.current(issueId);
                },
              },
            });
          });
        }
      };
    },
    [toast],
  );

  // enrich is mode-aware: every entry point (button, keyboard) goes through
  // here, so fast vs deep is decided in exactly one place.
  const enrich = useCallback(async () => {
    const card = current;
    if (!card || enriching) return;
    setEnriching(true);
    try {
      const info = await getEnrichInfo();
      if (info.settings.mode === "deep") {
        const r = await api.deepEnrich(card.issue.id);
        startWatcher(r.runId, card.issue.id, card.issue.identifier);
        return;
      }
      const r = await api.enrich(card.issue.id);
      updateCard(card.issue.id, {
        issue: { ...card.issue, enrichment: r.enrichment },
      });
    } catch (e) {
      toast(`Enrichment failed: ${(e as Error).message}`, { tone: "error" });
    } finally {
      setEnriching(false);
    }
  }, [current, enriching, updateCard, toast]);

  const markNoticesRead = useCallback(() => setNotices((n) => n.map((x) => ({ ...x, read: true }))), []);
  const clearDoneNotices = useCallback(() => setNotices((n) => n.filter((x) => x.status === "running")), []);
  const activeRunFor = useCallback(
    (issueId: string) => notices.find((n) => n.issueId === issueId && n.status === "running")?.runId ?? null,
    [notices],
  );
  const getRunEvents = useCallback((runId: string) => runEvents.current.get(runId) ?? [], []);

  // focusIssue jumps the deck to a card, pulling the issue into the deck if
  // it paged out. Returns false only when the issue no longer exists.
  const focusIssue = useCallback(async (issueId: string) => {
    const idx = cardsRef.current.findIndex((c) => c.issue.id === issueId);
    if (idx >= 0) {
      setIndex(idx);
      return true;
    }
    try {
      const r = await api.getIssue(issueId);
      setCards((prev) => {
        const at = Math.min(indexRef.current, prev.length);
        const copy = [...prev];
        copy.splice(at, 0, { issue: r.issue, status: "pending" });
        return copy;
      });
      // Current index now points at the inserted card.
      return true;
    } catch {
      toast("Issue is no longer in the local index", { tone: "error" });
      return false;
    }
  }, [toast]);
  useEffect(() => {
    focusIssueRef.current = focusIssue;
  }, [focusIssue]);

  // Close all watchers on unmount.
  useEffect(() => {
    const w = watchers.current;
    return () => {
      for (const es of w.values()) es.close();
    };
  }, []);

  const refreshSync = useCallback(() => {
    void api.syncRefresh().then(() => {
      setSync((s) => (s ? { ...s, state: "syncing" } : s));
      prevSyncState.current = "syncing";
    });
  }, []);

  const value = useMemo<TriageCtx>(
    () => ({
      meta, metaError, sync, refreshSync, macros, reloadMacros,
      version, checkForUpdate,
      viewFilter, setViewFilter,
      cards, index, current, remaining, loading, swipe, busy,
      sessionTriaged, milestone,
      next, prev, skip, snooze, applyMacro, applyOps, undo, canUndo, enrich, enriching,
      reloadMeta: loadMeta,
      setIssueEnrichment, notices, markNoticesRead, clearDoneNotices,
      activeRunFor, getRunEvents, eventsTick, focusIssue,
      duplicatePrompt, cancelDuplicatePrompt,
      labelPrompt, cancelLabelPrompt,
    }),
    [
      meta, metaError, sync, refreshSync, macros, reloadMacros, version, checkForUpdate,
      viewFilter, setViewFilter,
      cards, index, current, remaining, loading, swipe, busy, sessionTriaged, milestone,
      next, prev, skip, snooze, applyMacro, applyOps, undo, canUndo, enrich, enriching,
      loadMeta, setIssueEnrichment, notices, markNoticesRead, clearDoneNotices,
      activeRunFor, getRunEvents, eventsTick, focusIssue,
      duplicatePrompt, cancelDuplicatePrompt,
      labelPrompt, cancelLabelPrompt,
    ],
  );

  return <TriageContext.Provider value={value}>{children}</TriageContext.Provider>;
}
