import { describe, expect, it } from "vitest";
import { linearIssueHref } from "./linear";

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
