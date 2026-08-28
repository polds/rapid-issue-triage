import { describe, expect, it } from "vitest";
import { decodeLinearFilterURL } from "./linearfilter";

// Mirrors what linear.app puts in ?filter=: base64url, padding stripped.
const encode = (o: unknown) => {
  let b64 = btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_");
  // Not `/=+$/`: that rescans from every `=` on a string that is all padding,
  // which is quadratic. Fixture or not, the rule is right and the loop is
  // clearer anyway -- base64 padding is never more than two characters.
  while (b64.endsWith("=")) b64 = b64.slice(0, -1);
  return b64;
};

describe("decodeLinearFilterURL", () => {
  const filter = { team: { key: { eq: "ENG" } }, priority: { lte: 2 } };

  it("decodes the base64url filter param out of a linear view url", () => {
    const url = `https://linear.app/acme/team/ENG/all?filter=${encode(filter)}`;
    expect(decodeLinearFilterURL(url)).toEqual(filter);
  });

  it("accepts a bare base64url payload with no url wrapper", () => {
    expect(decodeLinearFilterURL(encode(filter))).toEqual(filter);
  });

  it("trims surrounding whitespace", () => {
    expect(decodeLinearFilterURL(`  ${encode(filter)}  `)).toEqual(filter);
  });

  it("restores padding for payloads of any length mod 4", () => {
    for (const o of [{ a: 1 }, { ab: 1 }, { abc: 1 }, { abcd: 1 }]) {
      expect(decodeLinearFilterURL(encode(o))).toEqual(o);
    }
  });

  it("rejects a url with no filter param", () => {
    expect(() => decodeLinearFilterURL("https://linear.app/acme/team/ENG/all")).toThrow(
      /no \?filter= parameter/,
    );
  });

  it("rejects a payload that decodes to a non-object", () => {
    expect(() => decodeLinearFilterURL(encode("just a string"))).toThrow(
      /not a filter object/,
    );
    expect(() => decodeLinearFilterURL(encode(null))).toThrow(/not a filter object/);
  });

  it("rejects payloads that are not valid base64 json", () => {
    expect(() => decodeLinearFilterURL("!!!not-base64!!!")).toThrow();
  });
});
