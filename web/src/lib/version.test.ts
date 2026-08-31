import { describe, expect, it } from "vitest";
import type { UpdateStatus, VersionInfo } from "./types";
import {
  buildDate,
  buildTooltip,
  displayVersion,
  hasUpdate,
  releaseHref,
  shortCommit,
  updateSummary,
} from "./version";

const info = (v: Partial<VersionInfo> = {}, u: Partial<UpdateStatus> = {}): VersionInfo => ({
  version: "v0.1.1",
  commit: "5fc31f49c73e",
  date: "2026-08-28T09:00:00Z",
  dev: false,
  ...v,
  update: { enabled: true, checking: false, available: false, ...u },
});

describe("shortCommit", () => {
  it("takes the first seven characters", () => {
    expect(shortCommit("5fc31f49c73e")).toBe("5fc31f4");
    expect(shortCommit("abc")).toBe("abc");
  });
  it("tolerates a missing commit", () => {
    expect(shortCommit()).toBe("");
    expect(shortCommit("  ")).toBe("");
  });
});

describe("displayVersion", () => {
  it("shows the tag for a release build", () => {
    expect(displayVersion(info())).toBe("v0.1.1");
  });
  it("shows dev plus the commit for an unreleased build", () => {
    expect(displayVersion(info({ version: "dev", dev: true }))).toBe("dev · 5fc31f4");
  });
  it("falls back to dev when nothing was stamped", () => {
    expect(displayVersion(info({ version: "", commit: "", dev: true }))).toBe("dev");
  });
});

describe("buildDate", () => {
  it("trims an RFC3339 stamp to the day", () => {
    expect(buildDate("2026-08-28T09:00:00Z")).toBe("2026-08-28");
    expect(buildDate("2026-08-28")).toBe("2026-08-28");
  });
  it("passes anything else through rather than inventing a date", () => {
    expect(buildDate("unknown")).toBe("unknown");
    expect(buildDate()).toBe("");
  });
});

describe("buildTooltip", () => {
  it("describes a release build that is up to date", () => {
    expect(buildTooltip(info({}, { checkedAt: "2026-08-31T00:00:00Z" }))).toBe(
      "triage v0.1.1 · commit 5fc31f4 · built 2026-08-28 · up to date",
    );
  });
  it("names the newer release when there is one", () => {
    expect(buildTooltip(info({}, { available: true, latest: "v0.2.0" }))).toContain("v0.2.0 available");
  });
  it("says when the check is off, and when it failed", () => {
    expect(buildTooltip(info({}, { enabled: false }))).toContain("update check off");
    expect(buildTooltip(info({}, { error: "github rate limit reached" }))).toContain(
      "update check failed: github rate limit reached",
    );
  });
  it("omits parts that were never stamped", () => {
    expect(buildTooltip(info({ version: "dev", commit: "", date: "", dev: true }))).toBe("triage dev");
  });
});

describe("hasUpdate", () => {
  it("is true only for an offered, enabled, released update", () => {
    expect(hasUpdate(info({}, { available: true, latest: "v0.2.0" }))).toBe(true);
  });
  it("is false without an update, a checker, a tag, or a release build", () => {
    expect(hasUpdate(null)).toBe(false);
    expect(hasUpdate(info())).toBe(false);
    expect(hasUpdate(info({}, { available: true, latest: "v0.2.0", enabled: false }))).toBe(false);
    expect(hasUpdate(info({}, { available: true }))).toBe(false);
    expect(hasUpdate(info({ dev: true }, { available: true, latest: "v0.2.0" }))).toBe(false);
  });
});

describe("releaseHref", () => {
  it("uses the release URL GitHub returned", () => {
    expect(releaseHref(info({}, { releaseUrl: "https://example.test/r" }))).toBe("https://example.test/r");
  });
  it("falls back to the releases page", () => {
    expect(releaseHref(info())).toBe("https://github.com/polds/rapid-issue-triage/releases/latest");
  });
});

describe("updateSummary", () => {
  const cases: [string, VersionInfo, string][] = [
    ["off", info({}, { enabled: false }), "Update checks are off (update_check.enabled in your config)."],
    ["checking", info({}, { checking: true }), "Checking…"],
    ["failed", info({}, { error: "boom" }), "Last check failed: boom"],
    ["available", info({}, { available: true, latest: "v0.2.0" }), "v0.2.0 is available."],
    ["current", info({}, { checkedAt: "2026-08-31T00:00:00Z" }), "You are on the latest release."],
    ["not checked", info(), "Not checked yet."],
    ["dev build", info({ dev: true }), "This is an unreleased build."],
    [
      "dev build with a known release",
      info({ dev: true }, { latest: "v0.2.0", checkedAt: "2026-08-31T00:00:00Z" }),
      "Latest release is v0.2.0. This is an unreleased build.",
    ],
  ];
  it.each(cases)("reports %s", (_name, i, want) => {
    expect(updateSummary(i)).toBe(want);
  });

  // An error outranks a stale "up to date": the user needs to know the answer
  // on screen may be out of date.
  it("prefers the failure over the last good result", () => {
    expect(updateSummary(info({}, { error: "boom", checkedAt: "2026-08-31T00:00:00Z", latest: "v0.1.1" }))).toBe(
      "Last check failed: boom",
    );
  });
});
