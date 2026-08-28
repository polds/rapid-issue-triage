import { describe, expect, it } from "vitest";
import { labelColor, teamColor } from "./colors";

describe("teamColor", () => {
  it("is stable for the same key", () => {
    expect(teamColor("ENG")).toBe(teamColor("ENG"));
  });

  it("always returns an in-gamut oklch color", () => {
    for (const key of ["ENG", "OPS", "DES", "", "a-very-long-team-key"]) {
      expect(teamColor(key)).toMatch(/^oklch\(0\.62 0\.14 \d+\)$/);
    }
  });

  it("separates at least a few distinct teams", () => {
    const seen = new Set(["ENG", "OPS", "DES", "SRE"].map(teamColor));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("labelColor", () => {
  it("passes through a six-digit hex in either case", () => {
    expect(labelColor("#ff8800")).toBe("#ff8800");
    expect(labelColor("#FF8800")).toBe("#FF8800");
  });

  it("falls back to the muted token for anything else", () => {
    for (const bad of ["", "red", "#fff", "#ff88000", "javascript:alert(1)"]) {
      expect(labelColor(bad)).toBe("var(--muted-foreground)");
    }
  });
});
