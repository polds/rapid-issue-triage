// Pure formatting for the build stamp and the update check. The server decides
// whether an update exists (internal/update compares the versions); everything
// here only decides how to say it.
import type { VersionInfo } from "./types";

// A commit is stamped as 12 hex characters; 7 is what a human reads.
const SHORT_COMMIT = 7;

export function shortCommit(commit?: string): string {
  return (commit ?? "").trim().slice(0, SHORT_COMMIT);
}

// The label in the top bar and Settings: the tag for a release build, and for
// an unreleased one "dev" plus whatever commit it was built from.
export function displayVersion(info: VersionInfo): string {
  const v = info.version.trim() || "dev";
  const sha = shortCommit(info.commit);
  return info.dev && sha ? `${v} · ${sha}` : v;
}

// Build date as YYYY-MM-DD. The stamp is RFC3339 UTC end to end; anything that
// is not is passed through rather than rendered as "Invalid Date".
export function buildDate(date?: string): string {
  const d = (date ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : d;
}

// One line for a title attribute: what is running, and where the update check
// stands. Deliberately terse — it is a tooltip, not the Settings panel.
export function buildTooltip(info: VersionInfo): string {
  const parts = [`triage ${info.version.trim() || "dev"}`];
  const sha = shortCommit(info.commit);
  if (sha) parts.push(`commit ${sha}`);
  const built = buildDate(info.date);
  if (built) parts.push(`built ${built}`);
  const u = info.update;
  if (!u.enabled) parts.push("update check off");
  else if (u.available && u.latest) parts.push(`${u.latest} available`);
  else if (u.error) parts.push(`update check failed: ${u.error}`);
  else if (u.checkedAt) parts.push("up to date");
  return parts.join(" · ");
}

// Whether to show the "new version" affordance. A dev build never nags: it is
// not on the release track, so "newer" means nothing for it.
export function hasUpdate(info: VersionInfo | null): boolean {
  if (!info) return false;
  const u = info.update;
  return u.enabled && u.available && !info.dev && Boolean(u.latest);
}

// Where "Update available" points. Falls back to the repository's releases
// page when GitHub gave us a tag but no URL.
export function releaseHref(info: VersionInfo): string {
  return info.update.releaseUrl ?? "https://github.com/polds/rapid-issue-triage/releases/latest";
}

// The one-line state for the Settings row: what the last check concluded.
export function updateSummary(info: VersionInfo): string {
  const u = info.update;
  if (!u.enabled) return "Update checks are off (update_check.enabled in your config).";
  if (u.checking) return "Checking…";
  if (u.error) return `Last check failed: ${u.error}`;
  if (hasUpdate(info)) return `${u.latest} is available.`;
  if (info.dev) return u.latest ? `Latest release is ${u.latest}. This is an unreleased build.` : "This is an unreleased build.";
  if (u.checkedAt) return "You are on the latest release.";
  return "Not checked yet.";
}
