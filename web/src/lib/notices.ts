// How one enrichment notice reads in the bell dropdown. Runs are pooled
// server-side, so a notice has four states rather than three — a queued run is
// accepted but not started — and every consumer has to agree on which of them
// count as still owed an answer. That agreement lives here, tested, rather
// than as conditions spread across the dropdown and the card.
import type { EnrichNotice } from "./triage-context";
import { timeAgo } from "./utils";

const VERDICT_LABEL: Record<string, string> = {
  actionable: "Actionable",
  likely_obsolete: "Likely obsolete",
  possibly_done: "Possibly done",
  needs_info: "Needs info",
  duplicate_suspect: "Duplicate?",
};

// noticeIsActive: a run the pool still owes an answer for. Queued counts —
// dropping a queued notice would orphan a run that has not started yet, and
// it is what stops the card offering "Enrich" a second time.
export function noticeIsActive(n: EnrichNotice): boolean {
  return n.status === "queued" || n.status === "running";
}

// noticeDetail: the one-line status under an entry's identifier.
export function noticeDetail(n: EnrichNotice): string {
  switch (n.status) {
    case "queued":
      return "waiting for a free slot";
    case "running":
      return "click to watch live";
    case "error":
      return n.error ?? "failed";
    default:
      return VERDICT_LABEL[n.verdict ?? ""] ?? "Report ready";
  }
}

// noticeWhen: the timestamp column. An active run has no meaningful
// "finished N ago", so it says what it is doing instead — including its place
// in the pool's line.
export function noticeWhen(n: EnrichNotice): string {
  if (n.status === "running") return "investigating…";
  if (n.status !== "queued") return timeAgo(n.at);
  return n.position && n.position > 0 ? `queued · #${n.position}` : "queued";
}
