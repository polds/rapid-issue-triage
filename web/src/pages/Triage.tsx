import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Inbox, Loader2, Undo2 } from "lucide-react";
import { useTriage } from "@/lib/store";
import { IssueCard } from "@/components/triage/IssueCard";
import { ActionBar } from "@/components/triage/ActionBar";
import { QuickEditRow, type PickerKey } from "@/components/triage/QuickEditRow";
import { HelpOverlay } from "@/components/triage/HelpOverlay";
import { Confetti } from "@/components/triage/Confetti";
import { Button } from "@/components/ui/button";

export function TriagePage() {
  const {
    current, cards, index, remaining, loading, metaError,
    macros, applyMacro, skip, snooze, next, prev, undo, canUndo,
    milestone, sessionTriaged, enrich, sync, refreshSync,
  } = useTriage();

  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState<PickerKey | null>(null);
  const [help, setHelp] = useState(false);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable))
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key;
      if (k === "?") {
        e.preventDefault();
        setHelp((h) => !h);
        return;
      }
      if (picker || help) return;

      if (k === "ArrowRight") return void (e.preventDefault(), next());
      if (k === "ArrowLeft") return void (e.preventDefault(), prev());
      if (k === " ") return void (e.preventDefault(), setExpanded((v) => !v));

      const lower = k.toLowerCase();
      if (lower === "s") return void (e.preventDefault(), skip());
      if (lower === "z") return void (e.preventDefault(), snooze());
      if (lower === "u") return void (e.preventDefault(), undo());
      if (lower === "i") return void (e.preventDefault(), enrich());
      if (lower === "o" && current) {
        e.preventDefault();
        window.open(current.issue.url, "_blank");
        return;
      }
      if (lower === "l") return void (e.preventDefault(), setPicker("labels"));
      if (lower === "e") return void (e.preventDefault(), setPicker("estimate"));
      if (lower === "c") return void (e.preventDefault(), setPicker("cycle"));
      if (lower === "p") return void (e.preventDefault(), setPicker("project"));
      if (lower === "a") return void (e.preventDefault(), setPicker("assignee"));
      if (lower === "x") return void (e.preventDefault(), setPicker("status"));

      if (/^[1-9]$/.test(k)) {
        const macro = macros[Number(k) - 1];
        if (macro) {
          e.preventDefault();
          applyMacro(macro);
        }
      }
    },
    [picker, help, next, prev, skip, snooze, undo, macros, applyMacro, enrich, current],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        <div className="mb-4 flex items-center justify-between">
          <Button variant="quiet" size="sm" onClick={prev} disabled={index === 0}>
            <ArrowLeft /> Prev
          </Button>
          <span className="font-mono text-xs text-muted-foreground">
            {cards.length ? index + 1 : 0} / {cards.length} in deck · {sessionTriaged} triaged
          </span>
          <Button variant="quiet" size="sm" onClick={next} disabled={index >= cards.length - 1}>
            Next <ArrowRight />
          </Button>
        </div>

        {metaError && (
          <div className="surface-card mb-4 rounded-xl border-destructive/40 p-4 text-sm text-destructive">
            Can't reach the local server: {metaError}
          </div>
        )}

        {current ? (
          <>
            <IssueCard card={current} expanded={expanded} setExpanded={setExpanded} />
            <div className="mt-6 space-y-4">
              <ActionBar />
              <QuickEditRow open={picker} setOpen={setPicker} />
              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={undo} disabled={!canUndo}>
                  <Undo2 /> Undo last action
                  <kbd className="kbd ml-1 h-5">U</kbd>
                </Button>
              </div>
            </div>
          </>
        ) : loading || sync?.state === "syncing" ? (
          <div className="surface-card mt-10 rounded-2xl p-12 text-center">
            <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">
              {sync?.state === "syncing" ? "First sync in progress…" : "Loading queue…"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Indexing your Linear backlog into the local database.
            </p>
          </div>
        ) : (
          <div className="surface-card mt-10 rounded-2xl p-12 text-center">
            <Inbox className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">
              {remaining > 0 ? "Deck exhausted" : "Inbox zero for this view"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {remaining > 0
                ? "Refresh to reload remaining issues."
                : "Nothing left to triage here. Switch teams up top to keep the streak going."}
            </p>
            <Button className="mt-4" variant="quiet" size="sm" onClick={refreshSync}>
              Refresh from Linear
            </Button>
          </div>
        )}
      </main>

      <HelpOverlay open={help} onClose={() => setHelp(false)} />
      <Confetti trigger={milestone} />
    </>
  );
}
