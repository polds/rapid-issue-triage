import { describe, expect, it } from "vitest";
import {
  LINEAR_THEME_EXAMPLE,
  THEME_VAR_NAMES,
  formatLinearTheme,
  isDarkTheme,
  luminance,
  parseLinearTheme,
  themeSwatches,
  themeVars,
} from "./linearstyle";

const NORD = "#2E3440,#ECEFF4,#3B4252,#ECEFF4,#88C0D0,#2E3440";

describe("parseLinearTheme", () => {
  it("maps the six slots in Linear's order", () => {
    expect(parseLinearTheme(LINEAR_THEME_EXAMPLE)).toEqual({
      base: "#FFFFFF",
      text: "#44494D",
      sidebar: "#EDEEF3",
      sidebarText: "#44494D",
      accent: "#475BA1",
      accentText: "#FFFFFF",
    });
  });

  it("tolerates pasted whitespace, missing hashes and lowercase", () => {
    const t = parseLinearTheme(" ffffff , 44494d,#edeef3 ,#44494D,#475ba1,#FFFFFF ");
    expect(t).not.toBeNull();
    expect(formatLinearTheme(t!)).toBe(LINEAR_THEME_EXAMPLE);
  });

  it("rejects the wrong count, short hex, and anything that is not a color", () => {
    expect(parseLinearTheme("#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1")).toBeNull();
    expect(parseLinearTheme(`${LINEAR_THEME_EXAMPLE},#000000`)).toBeNull();
    expect(parseLinearTheme("#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,#FFF")).toBeNull();
    expect(parseLinearTheme("#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,url(x)")).toBeNull();
    expect(parseLinearTheme("")).toBeNull();
  });
});

describe("luminance / isDarkTheme", () => {
  it("brackets black and white and grades the midpoint", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(luminance("#808080")).toBeCloseTo(0.2159, 3);
  });

  it("decides dark from the base background only", () => {
    expect(isDarkTheme(parseLinearTheme(NORD)!)).toBe(true);
    expect(isDarkTheme(parseLinearTheme(LINEAR_THEME_EXAMPLE)!)).toBe(false);
    // A light base with dark chrome is still a light theme.
    expect(isDarkTheme(parseLinearTheme("#FDF6E3,#073642,#002B36,#93A1A1,#D33682,#FDF6E3")!)).toBe(false);
  });
});

describe("themeVars", () => {
  it("passes the six colors through to the tokens they own", () => {
    const v = themeVars(parseLinearTheme(LINEAR_THEME_EXAMPLE)!);
    expect(v["--background"]).toBe("#FFFFFF");
    expect(v["--foreground"]).toBe("#44494D");
    expect(v["--chrome"]).toBe("#EDEEF3");
    expect(v["--chrome-foreground"]).toBe("#44494D");
    expect(v["--primary"]).toBe("#475BA1");
    expect(v["--primary-foreground"]).toBe("#FFFFFF");
    expect(v["--ring"]).toBe("#475BA1");
  });

  it("derives the neutrals with color-mix so no token is left at the default", () => {
    const v = themeVars(parseLinearTheme(NORD)!);
    expect(v["--surface-2"]).toBe("color-mix(in oklab, #3B4252 70%, #2E3440)");
    expect(v["--muted-foreground"]).toBe("color-mix(in oklab, #ECEFF4 64%, #2E3440)");
    expect(v["--border"]).toContain("14%");
    expect(v["--card"]).toBe("color-mix(in oklab, #ECEFF4 6%, #2E3440)");
  });

  it("does not lift surfaces on a light base", () => {
    const v = themeVars(parseLinearTheme(LINEAR_THEME_EXAMPLE)!);
    expect(v["--card"]).toBe("color-mix(in oklab, #44494D 0%, #FFFFFF)");
    expect(v["--border"]).toContain("11%");
  });

  it("never emits anything but hex and color-mix", () => {
    const v = themeVars(parseLinearTheme(NORD)!);
    for (const value of Object.values(v)) {
      expect(value).toMatch(/^(#[0-9A-F]{6}|color-mix\(|0 0 0 4px color-mix\()/);
    }
  });

  it("lists every name it sets", () => {
    const v = themeVars(parseLinearTheme(NORD)!);
    expect(new Set(THEME_VAR_NAMES)).toEqual(new Set(Object.keys(v)));
  });
});

describe("themeSwatches", () => {
  it("labels the slots the way Linear does, in order", () => {
    expect(themeSwatches(parseLinearTheme(LINEAR_THEME_EXAMPLE)!).map((s) => s.label)).toEqual([
      "Base",
      "Text",
      "Sidebar",
      "Sidebar text",
      "Accent",
      "Accent text",
    ]);
  });
});
