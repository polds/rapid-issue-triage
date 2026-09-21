/** Build a Linear issue URL from an identifier, using the current issue's URL as a template. */
export function linearIssueHref(identifier: string, fromIssueUrl?: string, explicit?: string): string | undefined {
  if (explicit && /^https?:/.test(explicit)) return explicit;
  if (!identifier || !fromIssueUrl) return undefined;
  const m = fromIssueUrl.match(/^(https:\/\/linear\.app\/[^/]+\/issue\/)/);
  return m ? m[1] + identifier : undefined;
}

/**
 * Extract a Linear issue identifier (e.g. "ENG-196") from user input that is
 * either a bare identifier or a pasted linear.app issue URL, so the ticket
 * search can resolve a link to the right ticket. Returns the upper-cased
 * identifier, or null when the input is neither. The identifier is always
 * upper-cased since Linear identifiers are, and `issue(id:)` is case-sensitive.
 */
export function parseLinearIssueIdentifier(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // A bare identifier: one or more letters, a hyphen, then digits.
  if (/^[A-Za-z]+-\d+$/.test(s)) return s.toUpperCase();
  // A linear.app URL: .../issue/<IDENT>/<slug> (slug optional). Accept the
  // scheme being present or not, and ignore any query/fragment.
  const m = s.match(/linear\.app\/[^/]+\/issue\/([A-Za-z]+-\d+)(?:[/?#]|$)/);
  return m ? m[1].toUpperCase() : null;
}
