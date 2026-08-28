// Macro management: user-defined one-key action sequences.
import { useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { labelColor } from "@/lib/colors";
import { useTriage } from "@/lib/triage-context";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import type { Macro, Op } from "@/lib/types";

type Draft = Omit<Macro, "id"> & { id?: number };

const TONE_RING: Record<string, string> = {
  accepted: "border-success/35 bg-success/8",
  done: "border-success/35 bg-success/8",
  cancelled: "border-destructive/35 bg-destructive/8",
  custom: "border-border bg-surface",
};

const STEP_KINDS = [
  { kind: "add_label", label: "Add labels" },
  { kind: "set_state", label: "Set status" },
  { kind: "set_project", label: "Move to project" },
  { kind: "set_estimate", label: "Set estimate" },
  { kind: "set_cycle", label: "Set cycle" },
  { kind: "set_assignee", label: "Assign to me" },
  { kind: "add_comment", label: "Add comment" },
  { kind: "post_ai_report", label: "Post AI report comment" },
] as const;

function describeOp(op: Op, projectName: (id: string) => string): string {
  switch (op.type) {
    case "add_label":
      return `+ ${(op.labelNames ?? (op.labelName ? [op.labelName] : [])).join(", ") || op.labelId}`;
    case "remove_label":
      return `− ${(op.labelNames ?? (op.labelName ? [op.labelName] : [])).join(", ") || op.labelId}`;
    case "set_state":
      return `status → ${op.stateName ?? op.stateType ?? op.stateId}`;
    case "set_estimate":
      return op.clear ? "clear estimate" : `estimate → ${op.estimate}`;
    case "set_project":
      return op.clear ? "clear project" : `project → ${projectName(op.projectId ?? "")}`;
    case "set_cycle":
      return op.cycleId === "active" ? "cycle → active" : op.clear ? "clear cycle" : "set cycle";
    case "set_assignee":
      return op.assigneeId === "me" ? "assign to me" : op.clear ? "unassign" : "assign";
    case "add_comment":
      return `comment: "${(op.body ?? "").slice(0, 40)}${(op.body ?? "").length > 40 ? "…" : ""}"`;
    case "post_ai_report":
      return "post AI report";
  }
}

export function MacrosPage() {
  const { macros, reloadMacros, meta } = useTriage();
  
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Reorder by drag: persist new positions for every macro that moved.
  const reorder = async (from: number, to: number) => {
    if (from === to) return;
    const next = [...macros];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    try {
      await Promise.all(
        // flatMap, not map+null: Promise.all over an array padded with nulls
        // works but obscures that unmoved macros are simply not written.
        next.flatMap((m, i) =>
          m.position !== i || m.id === moved.id ? [api.updateMacro({ ...m, position: i })] : [],
        ),
      );
      await reloadMacros();
    } catch (e) {
      toast(`Reorder failed: ${(e as Error).message}`, { tone: "error" });
    }
  };

  const labelNames = useMemo(
    () => [...new Set((meta?.labels ?? []).filter((l) => !l.isGroup).map((l) => l.name))].sort(),
    [meta],
  );
  const stateNames = useMemo(
    () => [...new Set((meta?.states ?? []).map((s) => s.name))].sort(),
    [meta],
  );
  const projectName = (id: string) => meta?.projects.find((p) => p.id === id)?.name ?? id;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      if (draft.id) await api.updateMacro(draft as Macro);
      else await api.createMacro(draft);
      await reloadMacros();
      setDraft(null);
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.deleteMacro(id);
      await reloadMacros();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, { tone: "error" });
    }
  };

  const setStep = (i: number, op: Op) => {
    if (!draft) return;
    const steps = [...draft.steps];
    steps[i] = op;
    setDraft({ ...draft, steps });
  };

  const defaultOpFor = (kind: Op["type"]): Op => {
    switch (kind) {
      case "add_label":
      case "remove_label":
        return { type: kind, labelNames: [] };
      case "set_state":
        return { type: kind, stateName: stateNames[0] ?? "" };
      case "set_project":
        return { type: kind, projectId: meta?.projects[0]?.id ?? "" };
      case "set_estimate":
        return { type: kind, estimate: 1 };
      case "set_cycle":
        return { type: kind, cycleId: "active" };
      case "set_assignee":
        return { type: kind, assigneeId: "me" };
      case "add_comment":
        return { type: kind, body: "" };
      case "post_ai_report":
        return { type: kind };
    }
  };

  // Which step's value picker is open, and what it selects.
  const [pickerAt, setPickerAt] = useState<{ index: number; kind: "labels" | "status" | "project" } | null>(null);

  const labelColorOf = (name: string) =>
    labelColor(meta?.labels.find((l) => l.name === name)?.color ?? "");

  const chipButton = (label: React.ReactNode, onClick: () => void) => (
    <button
      onClick={onClick}
      className="flex h-8 w-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden rounded-md border border-border bg-surface px-2.5 text-left text-xs transition-colors hover:bg-accent"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Macros</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One keystroke, a whole sequence of actions. Keys 1–9 fire from the triage view in the
            order below — drag to reorder. Labels and statuses are matched by name per team, so one
            macro works everywhere.
          </p>
        </div>
        <Button
          onClick={() => setDraft({ name: "", keyBinding: "", outcome: "accepted", steps: [], position: macros.length })}
        >
          <Plus /> New macro
        </Button>
      </div>

      <div className="mt-8 grid gap-3">
        {macros.map((m, idx) => (
          <div
            key={m.id}
            draggable
            onDragStart={() => (dragFrom.current = idx)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(idx);
            }}
            onDragLeave={() => setDragOver((d) => (d === idx ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              if (dragFrom.current !== null) void reorder(dragFrom.current, idx);
              dragFrom.current = null;
            }}
            className={`cursor-grab rounded-xl border p-4 shadow-card transition-shadow hover:shadow-pop active:cursor-grabbing ${TONE_RING[m.outcome] ?? TONE_RING.custom} ${
              dragOver === idx ? "ring-2 ring-primary/50" : ""
            }`}
          >
            <div className="flex items-start gap-3">
              <GripVertical className="mt-1 size-4 shrink-0 text-muted-foreground/50" />
              <kbd className="kbd mt-0.5 size-7 text-sm">{idx < 9 ? idx + 1 : "·"}</kbd>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">{m.name}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {m.steps.map((a, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      {i > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
                      <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {describeOp(a, projectName)}
                      </span>
                    </span>
                  ))}
                  {!m.steps.length && <span className="text-xs text-muted-foreground">No actions yet</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="iconSm" onClick={() => setDraft({ ...m })} aria-label="Edit macro">
                  <Pencil />
                </Button>
                <Button variant="ghost" size="iconSm" onClick={() => remove(m.id)} aria-label="Delete macro">
                  <Trash2 />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {!macros.length && (
          <div className="surface-card rounded-xl p-8 text-center text-sm text-muted-foreground">
            No macros yet. Try “Accept → add <span className="font-mono">triaged</span> label” or
            “Cancel → status Canceled + assign to me”.
          </div>
        )}
      </div>

      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit macro" : "New macro"}
        className="sm:max-w-xl"
      >
        {draft && (
          <div className="grid min-w-0 gap-4">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_150px] gap-3">
              <label className="grid gap-1.5 text-xs font-medium">
                Name
                <input
                  value={draft.name}
                  placeholder="Accept → Reliability"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="h-9 rounded-md border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                Outcome
                <Select
                  value={draft.outcome}
                  onChange={(e) => setDraft({ ...draft, outcome: e.target.value as Macro["outcome"] })}
                  className="h-9 [&>select]:h-9"
                >
                  <option value="accepted">Accepted</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="done">Done</option>
                  <option value="custom">Custom</option>
                </Select>
              </label>
            </div>

            <div className="grid min-w-0 gap-2">
              <span className="text-xs font-medium">Actions</span>
              {draft.steps.map((a, i) => (
                <div key={i} className="flex min-w-0 items-center gap-2">
                  <span className="w-5 text-center font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <Select
                    value={a.type}
                    onChange={(e) => setStep(i, defaultOpFor(e.target.value as Op["type"]))}
                    className="w-[168px]"
                  >
                    {STEP_KINDS.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.label}
                      </option>
                    ))}
                  </Select>

                  {(a.type === "add_label" || a.type === "remove_label") &&
                    chipButton(
                      (a.labelNames ?? []).length ? (
                        <span className="flex min-w-0 flex-wrap items-center gap-1">
                          {(a.labelNames ?? []).map((n) => (
                            <span
                              key={n}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]"
                            >
                              <span className="size-1.5 rounded-full" style={{ background: labelColorOf(n) }} />
                              {n}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Pick labels…</span>
                      ),
                      () => setPickerAt({ index: i, kind: "labels" }),
                    )}
                  {a.type === "set_state" &&
                    chipButton(a.stateName || <span className="text-muted-foreground">Pick a status…</span>, () =>
                      setPickerAt({ index: i, kind: "status" }),
                    )}
                  {a.type === "set_project" &&
                    chipButton(
                      projectName(a.projectId ?? "") || <span className="text-muted-foreground">Pick a project…</span>,
                      () => setPickerAt({ index: i, kind: "project" }),
                    )}
                  {a.type === "set_estimate" && (
                    <Select
                      value={String(a.estimate)}
                      onChange={(e) => setStep(i, { ...a, estimate: Number(e.target.value) })}
                      className="flex-1"
                    >
                      {[0, 1, 2, 3, 5, 8].map((n) => (
                        <option key={n} value={n}>
                          {n} points
                        </option>
                      ))}
                    </Select>
                  )}
                  {a.type === "set_cycle" && (
                    <span className="flex-1 text-sm text-muted-foreground">Team's active cycle</span>
                  )}
                  {a.type === "set_assignee" && (
                    <span className="flex-1 text-sm text-muted-foreground">Assigns the issue to you</span>
                  )}
                  {a.type === "post_ai_report" && (
                    <span className="flex-1 text-sm text-muted-foreground">
                      Posts the stored AI report/summary; fails if the issue isn't enriched yet
                    </span>
                  )}
                  {a.type === "add_comment" && (
                    <input
                      value={a.body ?? ""}
                      placeholder="Triaged. Closing as obsolete."
                      onChange={(e) => setStep(i, { ...a, body: e.target.value })}
                      className="h-8 w-0 flex-1 rounded-md border border-input bg-surface px-2.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  )}

                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label="Remove step"
                    onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                variant="quiet"
                size="sm"
                className="justify-start"
                onClick={() => setDraft({ ...draft, steps: [...draft.steps, defaultOpFor("add_label")] })}
              >
                <Plus /> Add step
              </Button>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button disabled={!draft.name || !draft.steps.length || saving} onClick={save}>
                {saving ? "Saving…" : "Save macro"}
              </Button>
            </div>
          </div>
        )}
        {draft && pickerAt && pickerAt.kind === "labels" && (
          <Picker
            title="Labels"
            multi
            options={labelNames.map((n) => ({
              id: n,
              label: n,
              color: labelColorOf(n),
              selected: (draft.steps[pickerAt.index]?.labelNames ?? []).includes(n),
            }))}
            onPick={(id) => {
              const step = draft.steps[pickerAt.index];
              if (!step) return;
              const cur = step.labelNames ?? [];
              setStep(pickerAt.index, {
                ...step,
                labelNames: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
              });
            }}
            onClose={() => setPickerAt(null)}
          />
        )}
        {draft && pickerAt && pickerAt.kind === "status" && (
          <Picker
            title="Status"
            options={stateNames.map((n) => ({
              id: n,
              label: n,
              selected: draft.steps[pickerAt.index]?.stateName === n,
            }))}
            onPick={(id) => {
              const step = draft.steps[pickerAt.index];
              if (step) setStep(pickerAt.index, { ...step, stateName: id });
            }}
            onClose={() => setPickerAt(null)}
          />
        )}
        {draft && pickerAt && pickerAt.kind === "project" && (
          <Picker
            title="Project"
            options={(meta?.projects ?? []).map((p) => ({
              id: p.id,
              label: p.name,
              hint: p.state,
              selected: draft.steps[pickerAt.index]?.projectId === p.id,
            }))}
            onPick={(id) => {
              const step = draft.steps[pickerAt.index];
              if (step) setStep(pickerAt.index, { ...step, projectId: id });
            }}
            onClose={() => setPickerAt(null)}
          />
        )}
      </Dialog>
    </main>
  );
}
