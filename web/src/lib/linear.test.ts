import { describe, expect, it } from "vitest";
import { linearIssueHref, parseLinearIssueIdentifier } from "./linear";

const from = "https://linear.app/acme/issue/ENG-1/some-slug";

describe("linearIssueHref", () => {
  it("prefers an explicit http(s) url", () => {
    expect(linearIssueHref("ENG-2", from, "https://example.com/x")).toBe("https://example.com/x");
  });

  it("ignores a non-http explicit url and derives from the template", () => {
    expect(linearIssueHref("ENG-2", from, "javascript:alert(1)")).toBe(
      "https://linear.app/acme/issue/ENG-2",
    );
  });

  it("derives a sibling issue url from the current issue", () => {
    expect(linearIssueHref("ENG-2", from)).toBe("https://linear.app/acme/issue/ENG-2");
  });

  it("returns undefined without an identifier or a template", () => {
    expect(linearIssueHref("", from)).toBeUndefined();
    expect(linearIssueHref("ENG-2")).toBeUndefined();
  });

  it("returns undefined when the template is not a linear issue url", () => {
    expect(linearIssueHref("ENG-2", "https://example.com/issue/ENG-1")).toBeUndefined();
  });
});

describe("parseLinearIssueIdentifier", () => {
  it("resolves a full linear.app issue URL to its identifier", () => {
    expect(
      parseLinearIssueIdentifier("https://linear.app/acme/issue/ENG-196/some-issue-slug"),
    ).toBe("ENG-196");
  });

  it("resolves a URL with no slug, and one with query/fragment", () => {
    expect(parseLinearIssueIdentifier("https://linear.app/acme/issue/ENG-42")).toBe("ENG-42");
    expect(parseLinearIssueIdentifier("https://linear.app/acme/issue/ENG-42/x?foo=1#c")).toBe("ENG-42");
  });

  it("accepts a bare identifier and upper-cases it", () => {
    expect(parseLinearIssueIdentifier("eng-196")).toBe("ENG-196");
    expect(parseLinearIssueIdentifier("  ENG-7  ")).toBe("ENG-7");
  });

  it("resolves a scheme-less linear.app URL", () => {
    expect(parseLinearIssueIdentifier("linear.app/acme/issue/ENG-1/slug")).toBe("ENG-1");
  });

  it("returns null for empty, a plain title, or a non-issue URL", () => {
    expect(parseLinearIssueIdentifier("")).toBeNull();
    expect(parseLinearIssueIdentifier("payment funnel telemetry")).toBeNull();
    expect(parseLinearIssueIdentifier("https://linear.app/acme/team/ENG/active")).toBeNull();
    expect(parseLinearIssueIdentifier("https://example.com/issue/ENG-1")).toBeNull();
  });
});
