// Linear label groups are mutually exclusive: only one child of a group may be
// on an issue at a time, and an update carrying two siblings is rejected with
// the opaque "labelIds not exclusive child labels".
//
// The server is the authority on this — it re-checks against the indexed labels
// before every mutation. What this module adds is the *pre-flight*: the same
// check run against synced metadata so a macro that would clash raises the
// replace prompt immediately, with no wasted round trip and no card swipe to
// undo. Same shape as `needsDuplicateOf` in store.tsx, and for the same reason.
import type { Label, LabelGroupConflict, Op } from "./types";

// resolveLabelId mirrors store.LabelIDByName: case-insensitive, a team label
// preferred over a workspace-wide one of the same name.
export function resolveLabelId(labels: Label[], teamId: string, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const matches = labels.filter((l) => l.name.toLowerCase() === wanted && (l.teamId === teamId || !l.teamId));
  return (matches.find((l) => l.teamId === teamId) ?? matches[0])?.id;
}

// labelIdsForOp collects every label an add_label/remove_label op references,
// resolving the name-based forms macros use. Unknown names are skipped: the
// server rejects those with its own message, which is the better one.
function labelIdsForOp(op: Op, labels: Label[], teamId: string): string[] {
  const ids = op.labelId ? [op.labelId] : [];
  const names = [...(op.labelNames ?? []), ...(op.labelName ? [op.labelName] : [])];
  for (const n of names) {
    const id = resolveLabelId(labels, teamId, n);
    if (id) ids.push(id);
  }
  return ids;
}

// labelGroupConflicts reports the exclusive groups that would end up holding
// more than one label once `ops` are applied to `issue`. An empty result means
// the action is safe to send as-is.
export function labelGroupConflicts(
  ops: Op[],
  issue: { teamId: string; labels: { id: string }[] },
  labels: Label[],
): LabelGroupConflict[] {
  const final = new Set(issue.labels.map((l) => l.id));
  const added = new Set<string>();
  // Mirrors resolveOps: with no label op the update carries no labelIds at all,
  // so a group the issue already violated is not this action's problem.
  let labelsChanged = false;
  for (const op of ops) {
    if (op.type !== "add_label" && op.type !== "remove_label") continue;
    labelsChanged = true;
    for (const id of labelIdsForOp(op, labels, issue.teamId)) {
      if (op.type === "add_label") {
        if (!final.has(id)) added.add(id);
        final.add(id);
      } else {
        final.delete(id);
        added.delete(id);
      }
    }
  }
  if (!labelsChanged) return [];
  return groupClashes(final, added, labels);
}

// groupClashes buckets the final label set by group and keeps the groups with
// siblings, splitting each into what the issue already had and what is new.
function groupClashes(final: Set<string>, added: Set<string>, labels: Label[]): LabelGroupConflict[] {
  const byId = new Map(labels.map((l) => [l.id, l]));
  const groups = new Map<string, Label[]>();
  for (const id of final) {
    const l = byId.get(id);
    if (!l?.parentId) continue;
    groups.set(l.parentId, [...(groups.get(l.parentId) ?? []), l]);
  }
  const out: LabelGroupConflict[] = [];
  for (const [groupId, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
    const incoming = sorted.filter((l) => added.has(l.id)).map((l) => l.name);
    const existing = sorted.filter((l) => !added.has(l.id)).map((l) => l.name);
    out.push({
      group: byId.get(groupId)?.name ?? "label group",
      existing,
      incoming,
      // Replacing is unambiguous only when the action adds exactly one sibling.
      resolvable: incoming.length === 1 && existing.length > 0,
    });
  }
  return out;
}

// describeConflict is the one-line explanation the prompt and the toast share.
export function describeConflict(c: LabelGroupConflict): string {
  const q = (n: string) => `“${n}”`;
  const list = (ns: string[]) =>
    ns.length > 1 ? `${ns.slice(0, -1).map(q).join(", ")} and ${q(ns[ns.length - 1])}` : q(ns[0] ?? "");
  const allows = `${q(c.group)} allows only one label per issue`;
  if (!c.incoming.length) return `${allows}, but this issue already has ${list(c.existing)}.`;
  if (!c.existing.length) return `${allows}, and this action adds ${list(c.incoming)}.`;
  return `${allows}. This issue has ${list(c.existing)}; this action adds ${list(c.incoming)}.`;
}
