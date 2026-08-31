import { describe, expect, it } from "vitest";
import { describeConflict, labelGroupConflicts, resolveLabelId } from "./labelgroups";
import type { Label, Op } from "./types";

// "Area" is a group; infrastructure and ci-cd are its exclusive children.
// "backlog:infra" and "bug" are ungrouped, and never clash with anything.
const labels: Label[] = [
  { id: "g1", teamId: "t1", name: "Area", color: "#000", isGroup: 1, parentId: "" },
  { id: "l1", teamId: "t1", name: "infrastructure", color: "#f00", isGroup: 0, parentId: "g1" },
  { id: "l2", teamId: "t1", name: "ci-cd", color: "#0f0", isGroup: 0, parentId: "g1" },
  { id: "l3", teamId: "t1", name: "backlog:infra", color: "#00f", isGroup: 0, parentId: "" },
  { id: "l4", teamId: "", name: "bug", color: "#888", isGroup: 0, parentId: "" },
];

const issue = (...labelIds: string[]) => ({ teamId: "t1", labels: labelIds.map((id) => ({ id })) });
const add = (...labelNames: string[]): Op => ({ type: "add_label", labelNames });

describe("resolveLabelId", () => {
  it("matches case-insensitively", () => {
    expect(resolveLabelId(labels, "t1", "CI-CD")).toBe("l2");
  });

  it("falls back to a workspace-wide label", () => {
    expect(resolveLabelId(labels, "t2", "bug")).toBe("l4");
  });

  it("prefers the team's own label over a workspace one of the same name", () => {
    const dupe: Label[] = [
      { id: "w1", teamId: "", name: "area", color: "#000", isGroup: 0, parentId: "" },
      { id: "t1a", teamId: "t1", name: "area", color: "#000", isGroup: 0, parentId: "" },
    ];
    expect(resolveLabelId(dupe, "t1", "area")).toBe("t1a");
  });

  it("returns undefined for an unknown name, and for another team's label", () => {
    expect(resolveLabelId(labels, "t1", "nope")).toBeUndefined();
    expect(resolveLabelId(labels, "t2", "ci-cd")).toBeUndefined();
  });
});

describe("labelGroupConflicts", () => {
  it("reports the real-world case: a macro adding a sibling of a label already on the issue", () => {
    const ops = [add("backlog:infra", "infrastructure")];
    const got = labelGroupConflicts(ops, issue("l2"), labels);
    expect(got).toEqual([
      { group: "Area", existing: ["ci-cd"], incoming: ["infrastructure"], resolvable: true },
    ]);
  });

  it("stays quiet when the added labels are ungrouped", () => {
    expect(labelGroupConflicts([add("backlog:infra")], issue("l1"), labels)).toEqual([]);
  });

  it("stays quiet when the group's only label is the one being added", () => {
    expect(labelGroupConflicts([add("infrastructure")], issue("l3"), labels)).toEqual([]);
  });

  it("stays quiet when re-adding the label the issue already has", () => {
    expect(labelGroupConflicts([add("ci-cd")], issue("l2"), labels)).toEqual([]);
  });

  it("is not resolvable when the action itself adds two siblings", () => {
    const got = labelGroupConflicts([add("ci-cd", "infrastructure")], issue(), labels);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ incoming: ["ci-cd", "infrastructure"], existing: [], resolvable: false });
  });

  it("is not resolvable when the issue already carried both siblings", () => {
    const got = labelGroupConflicts([add("backlog:infra")], issue("l1", "l2"), labels);
    expect(got[0]).toMatchObject({ existing: ["ci-cd", "infrastructure"], incoming: [], resolvable: false });
  });

  it("clears the clash when the macro removes the sibling first", () => {
    const ops: Op[] = [{ type: "remove_label", labelName: "ci-cd" }, add("infrastructure")];
    expect(labelGroupConflicts(ops, issue("l2"), labels)).toEqual([]);
  });

  it("stops blaming a label the macro adds and then removes", () => {
    const ops: Op[] = [add("infrastructure"), { type: "remove_label", labelName: "infrastructure" }];
    expect(labelGroupConflicts(ops, issue("l2"), labels)).toEqual([]);
  });

  it("resolves labels referenced by id as well as by name", () => {
    const got = labelGroupConflicts([{ type: "add_label", labelId: "l1" }], issue("l2"), labels);
    expect(got[0]).toMatchObject({ incoming: ["infrastructure"], resolvable: true });
  });

  it("accepts the single-name form macros also use", () => {
    const got = labelGroupConflicts([{ type: "add_label", labelName: "infrastructure" }], issue("l2"), labels);
    expect(got[0]).toMatchObject({ incoming: ["infrastructure"], resolvable: true });
  });

  it("ignores unknown label names and non-label ops — the server rejects those with its own message", () => {
    expect(labelGroupConflicts([add("ghost")], issue("l2"), labels)).toEqual([]);
    expect(labelGroupConflicts([{ type: "set_state", stateName: "Backlog" }], issue("l1", "l2"), labels)).toEqual([]);
  });

  it("falls back to a placeholder when the group label itself is not indexed", () => {
    const orphaned = labels.filter((l) => l.id !== "g1");
    const got = labelGroupConflicts([add("infrastructure")], issue("l2"), orphaned);
    expect(got[0].group).toBe("label group");
  });
});

describe("describeConflict", () => {
  it("names both sides of a replaceable clash", () => {
    const msg = describeConflict({ group: "Area", existing: ["ci-cd"], incoming: ["infrastructure"], resolvable: true });
    expect(msg).toContain("“Area” allows only one label per issue");
    expect(msg).toContain("“ci-cd”");
    expect(msg).toContain("“infrastructure”");
  });

  it("points at the action when it adds both", () => {
    const msg = describeConflict({ group: "Area", existing: [], incoming: ["ci-cd", "infrastructure"], resolvable: false });
    expect(msg).toContain("this action adds “ci-cd” and “infrastructure”");
  });

  it("points at the issue when it already carried both", () => {
    const msg = describeConflict({ group: "Area", existing: ["ci-cd", "infrastructure"], incoming: [], resolvable: false });
    expect(msg).toContain("already has “ci-cd” and “infrastructure”");
  });
});
