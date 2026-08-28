/** Build a Linear issue URL from an identifier, using the current issue's URL as a template. */
export function linearIssueHref(identifier: string, fromIssueUrl?: string, explicit?: string): string | undefined {
  if (explicit && /^https?:/.test(explicit)) return explicit;
  if (!identifier || !fromIssueUrl) return undefined;
  const m = fromIssueUrl.match(/^(https:\/\/linear\.app\/[^/]+\/issue\/)/);
  return m ? m[1] + identifier : undefined;
}
