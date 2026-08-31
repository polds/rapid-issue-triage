import { describe, expect, it, vi, afterEach } from "vitest";
import { cn, fmtMs, fmtTokens, fmtUsd, timeAgo, PRIORITY_NAMES } from "./utils";

describe("cn", () => {
  it("joins conditional classes and drops falsy ones", () => {
    const enabled: boolean = false;
    expect(cn("a", enabled && "b", undefined, "c")).toBe("a c");
  });

  it("lets the last conflicting tailwind utility win", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("timeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (now: string, iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    return timeAgo(iso);
  };

  it("returns an empty string for a missing timestamp", () => {
    expect(timeAgo("")).toBe("");
  });

  it("collapses anything under a minute to 'just now'", () => {
    expect(at("2026-01-01T00:00:30Z", "2026-01-01T00:00:00Z")).toBe("just now");
  });

  it("singularizes exactly one unit and pluralizes the rest", () => {
    expect(at("2026-01-01T01:00:00Z", "2026-01-01T00:00:00Z")).toBe("1 hour ago");
    expect(at("2026-01-01T03:00:00Z", "2026-01-01T00:00:00Z")).toBe("3 hours ago");
  });

  it("picks the largest fitting unit", () => {
    expect(at("2026-01-08T00:00:00Z", "2026-01-01T00:00:00Z")).toBe("1 week ago");
    expect(at("2027-01-01T00:00:00Z", "2026-01-01T00:00:00Z")).toBe("1 year ago");
  });

  it("clamps future timestamps instead of rendering negatives", () => {
    expect(at("2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z")).toBe("just now");
  });
});

describe("fmtMs", () => {
  it("renders a dash for zero and negative durations", () => {
    expect(fmtMs(0)).toBe("—");
    expect(fmtMs(-5)).toBe("—");
  });

  it("rounds sub-second durations to whole milliseconds", () => {
    expect(fmtMs(12.4)).toBe("12ms");
  });

  it("switches to seconds with one decimal, then to minutes", () => {
    expect(fmtMs(1500)).toBe("1.5s");
    expect(fmtMs(90_000)).toBe("1m 30s");
  });
});

describe("fmtTokens", () => {
  it("renders zero and negatives as a plain zero", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(-10)).toBe("0");
  });

  it("leaves counts under a thousand exact", () => {
    expect(fmtTokens(1)).toBe("1");
    expect(fmtTokens(999)).toBe("999");
  });

  it("keeps a decimal on small K values and drops it on large ones", () => {
    expect(fmtTokens(1500)).toBe("1.5K");
    expect(fmtTokens(29_717)).toBe("30K");
  });

  it("switches to millions with enough precision to distinguish runs", () => {
    expect(fmtTokens(1_240_000)).toBe("1.24M");
    expect(fmtTokens(42_500_000)).toBe("42.5M");
  });
});

describe("fmtUsd", () => {
  it("renders a true zero as $0.00", () => {
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtUsd(-1)).toBe("$0.00");
  });

  it("keeps sub-cent costs visible instead of rounding them away", () => {
    expect(fmtUsd(0.000942)).toBe("$0.0009");
    expect(fmtUsd(0.0342)).toBe("$0.034");
  });

  it("uses ordinary currency precision from a dollar up", () => {
    expect(fmtUsd(1.5)).toBe("$1.50");
    expect(fmtUsd(12.345)).toBe("$12.35");
  });
});

describe("PRIORITY_NAMES", () => {
  it("is indexed by Linear's numeric priority", () => {
    expect(PRIORITY_NAMES[0]).toBe("No priority");
    expect(PRIORITY_NAMES[1]).toBe("Urgent");
    expect(PRIORITY_NAMES).toHaveLength(5);
  });
});
