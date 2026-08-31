import { describe, expect, it } from "vitest";
import { noticeDetail, noticeIsActive, noticeWhen } from "./notices";
import type { EnrichNotice } from "./triage-context";

const notice = (over: Partial<EnrichNotice>): EnrichNotice => ({
  runId: "run_1",
  issueId: "i1",
  identifier: "CORE-1",
  status: "done",
  at: new Date().toISOString(),
  read: false,
  ...over,
});

describe("noticeIsActive", () => {
  it("counts a queued run as active, so it cannot be dismissed or re-queued", () => {
    expect(noticeIsActive(notice({ status: "queued", position: 2 }))).toBe(true);
    expect(noticeIsActive(notice({ status: "running" }))).toBe(true);
  });

  it("counts finished runs as inactive", () => {
    expect(noticeIsActive(notice({ status: "done" }))).toBe(false);
    expect(noticeIsActive(notice({ status: "error", error: "boom" }))).toBe(false);
  });
});

describe("noticeDetail", () => {
  it("names the verdict on a finished run", () => {
    expect(noticeDetail(notice({ verdict: "duplicate_suspect" }))).toBe("Duplicate?");
  });

  it("falls back when the verdict is missing or unknown", () => {
    expect(noticeDetail(notice({}))).toBe("Report ready");
    expect(noticeDetail(notice({ verdict: "who_knows" }))).toBe("Report ready");
  });

  it("explains a queued run rather than looking stalled", () => {
    expect(noticeDetail(notice({ status: "queued" }))).toBe("waiting for a free slot");
  });

  it("invites a click on a running one", () => {
    expect(noticeDetail(notice({ status: "running" }))).toBe("click to watch live");
  });

  it("surfaces the error, with a fallback when the server sent none", () => {
    expect(noticeDetail(notice({ status: "error", error: "claude not found" }))).toBe("claude not found");
    expect(noticeDetail(notice({ status: "error" }))).toBe("failed");
  });
});

describe("noticeWhen", () => {
  it("shows the place in line for a queued run", () => {
    expect(noticeWhen(notice({ status: "queued", position: 3 }))).toBe("queued · #3");
  });

  it("omits a position it does not have", () => {
    expect(noticeWhen(notice({ status: "queued" }))).toBe("queued");
    expect(noticeWhen(notice({ status: "queued", position: 0 }))).toBe("queued");
  });

  it("says what a running run is doing instead of when it started", () => {
    expect(noticeWhen(notice({ status: "running" }))).toBe("investigating…");
  });

  it("ages a finished run", () => {
    expect(noticeWhen(notice({ status: "done", at: "2020-01-01T00:00:00Z" }))).toMatch(/ago$/);
  });
});
