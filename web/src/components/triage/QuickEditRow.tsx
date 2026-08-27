// Quick edit: fast keyboard pickers that apply single-field ops to the
// current issue immediately (no card advance).
import { Hash, Layers, Repeat, Tag, User, Workflow } from "lucide-react";
import { useTriage } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { DuplicateOfPicker } from "./DuplicateOfPicker";
import { useState } from "react";
import { labelColor } from "@/lib/colors";
import type { Op } from "@/lib/types";

export type PickerKey = "labels" | "estimate" | "cycle" | "project" | "status" | "assignee";

const META: Record<PickerKey, { label: string; hint: string; icon: React.ReactNode }> = {
  labels: { label: "Labels", hint: "L", icon: <Tag className="size-4" /> },
  estimate: { label: "Estimate", hint: "E", icon: <Hash className="size-4" /> },
  cycle: { label: "Cycle", hint: "C", icon: <Repeat className="size-4" /> },
  project: { label: "Project", hint: "P", icon: <Layers className="size-4" /> },
  status: { label: "Status", hint: "X", icon: <Workflow className="size-4" /> },
  assignee: { label: "Assignee", hint: "A", icon: <User className="size-4" /> },
};

const ESTIMATES = [0, 1, 2, 3, 5, 8];

export function QuickEditRow({
  open,
  setOpen,
  vertical = false,
}: {
  open: PickerKey | null;
  setOpen: (k: PickerKey | null) => void;
  vertical?: boolean;
}) {
  const { current, meta, applyOps } = useTriage();
  const [duplicateState, setDuplicateState] = useState<string | null>(null);
  if (!current || !meta) return null;
  const issue = current.issue;

  const options = (key: PickerKey): PickerOption[] => {
    switch (key) {
      case "labels":
        return meta.labels
          .filter((l) => !l.isGroup && (!l.teamId || l.teamId === issue.teamId))
          .map((l) => ({
            id: l.id,
            label: l.name,
            color: labelColor(l.color),
            selected: (issue.labels ?? []).some((x) => x.id === l.id),
          }));
      case "estimate":
        return [
          ...ESTIMATES.map((e) => ({
            id: String(e),
            label: `${e} points`,
            selected: issue.estimate === e,
          })),
          { id: "clear", label: "No estimate", selected: issue.estimate === null },
        ];
      case "cycle":
        return [
          ...meta.cycles
            .filter((c) => c.teamId === issue.teamId)
            .map((c) => ({
              id: c.id,
              label: c.name || `Cycle ${c.number}`,
              hint: c.startsAt.slice(0, 10),
              selected: issue.cycleId === c.id,
            })),
          { id: "clear", label: "No cycle", selected: !issue.cycleId },
        ];
      case "project":
        return [
          ...meta.projects.map((p) => ({
            id: p.id,
            label: p.name,
            hint: p.state,
            selected: issue.projectId === p.id,
          })),
          { id: "clear", label: "No project", selected: !issue.projectId },
        ];
      case "status":
        return meta.states
          .filter((s) => s.teamId === issue.teamId)
          .map((s) => ({
            id: s.id,
            label: s.name,
            hint: s.type,
            color: s.color || undefined,
            selected: issue.stateId === s.id,
          }));
      case "assignee": {
        const me = meta.users.find((u) => u.isMe);
        const rest = meta.users.filter((u) => !u.isMe);
        const opts: PickerOption[] = [];
        if (me)
          opts.push({ id: me.id, label: `${me.displayName || me.name} (me)`, selected: issue.assigneeId === me.id });
        opts.push(
          ...rest.map((u) => ({
            id: u.id,
            label: u.displayName || u.name,
            selected: issue.assigneeId === u.id,
          })),
        );
        opts.push({ id: "clear", label: "Unassigned", selected: !issue.assigneeId });
        return opts;
      }
    }
  };

  const pick = (key: PickerKey, id: string) => {
    let op: Op;
    let desc: string;
    switch (key) {
      case "labels": {
        const has = (issue.labels ?? []).some((x) => x.id === id);
        const name = meta.labels.find((l) => l.id === id)?.name ?? "label";
        op = { type: has ? "remove_label" : "add_label", labelId: id };
        desc = `${has ? "−" : "+"} ${name}`;
        break;
      }
      case "estimate":
        op = id === "clear" ? { type: "set_estimate", clear: true } : { type: "set_estimate", estimate: Number(id) };
        desc = id === "clear" ? "Estimate cleared" : `Estimate → ${id}`;
        break;
      case "cycle":
        op = id === "clear" ? { type: "set_cycle", clear: true } : { type: "set_cycle", cycleId: id };
        desc = id === "clear" ? "Cycle cleared" : "Cycle set";
        break;
      case "project":
        op = id === "clear" ? { type: "set_project", clear: true } : { type: "set_project", projectId: id };
        desc =
          id === "clear"
            ? "Project cleared"
            : `Project → ${meta.projects.find((p) => p.id === id)?.name ?? ""}`;
        break;
      case "status": {
        // Duplicate-type states need the canonical issue first.
        if (meta.states.find((s) => s.id === id)?.type === "duplicate") {
          setDuplicateState(id);
          return;
        }
        op = { type: "set_state", stateId: id };
        desc = `Status → ${meta.states.find((s) => s.id === id)?.name ?? ""}`;
        break;
      }
      case "assignee":
        op = id === "clear" ? { type: "set_assignee", clear: true } : { type: "set_assignee", assigneeId: id };
        desc = id === "clear" ? "Unassigned" : "Assigned";
        break;
    }
    applyOps([op], desc);
  };

  return (
    <>
      <div
        className={vertical ? "flex flex-col gap-1.5" : "flex flex-wrap items-center justify-center gap-2"}
      >
        {(Object.keys(META) as PickerKey[]).map((key) => (
          <Button
            key={key}
            variant="quiet"
            size="sm"
            className={vertical ? "w-full justify-between gap-1.5" : "gap-1.5"}
            onClick={() => setOpen(key)}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {META[key].icon}
              <span className="truncate">{META[key].label}</span>
            </span>
            <kbd className="kbd ml-0.5 h-4 min-w-4 shrink-0 text-[10px]">{META[key].hint}</kbd>
          </Button>
        ))}
      </div>
      {open && (
        <Picker
          title={META[open].label}
          options={options(open)}
          multi={open === "labels"}
          onPick={(id) => pick(open, id)}
          onClose={() => setOpen(null)}
        />
      )}
      {duplicateState && (
        <DuplicateOfPicker
          identifier={issue.identifier}
          report={issue.enrichment?.report}
          onPick={(canonicalId) => {
            applyOps(
              [{ type: "set_state", stateId: duplicateState, duplicateOfId: canonicalId }],
              `Status → ${meta.states.find((s) => s.id === duplicateState)?.name ?? "Duplicate"}`,
            );
            setDuplicateState(null);
          }}
          onClose={() => setDuplicateState(null)}
        />
      )}
    </>
  );
}
