// decodeLinearFilterURL extracts and decodes the base64url `filter` param
// from a linear.app view/filter URL into IssueFilter JSON.
export function decodeLinearFilterURL(input: string): Record<string, unknown> {
  let raw = input.trim();
  try {
    const u = new URL(raw);
    raw = u.searchParams.get("filter") ?? "";
  } catch {
    /* not a URL — treat as the bare base64 payload */
  }
  if (!raw) throw new Error("no ?filter= parameter found in that URL");
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (raw.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof parsed !== "object" || parsed === null) throw new Error("decoded payload is not a filter object");
  return parsed as Record<string, unknown>;
}
