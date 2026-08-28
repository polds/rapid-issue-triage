import { describe, expect, it, vi, afterEach } from "vitest";
import { cn, fmtMs, timeAgo, PRIORITY_NAMES } from "./utils";

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

describe("PRIORITY_NAMES", () => {
  it("is indexed by Linear's numeric priority", () => {
    expect(PRIORITY_NAMES[0]).toBe("No priority");
    expect(PRIORITY_NAMES[1]).toBe("Urgent");
    expect(PRIORITY_NAMES).toHaveLength(5);
  });
});
