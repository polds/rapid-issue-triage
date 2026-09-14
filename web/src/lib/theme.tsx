// Light/dark provider plus the Linear-style custom theme.
//
// Two layers: the light/dark toggle (localStorage, per browser) and an
// optional six-color Linear theme string persisted server-side in sqlite so it
// follows the user across browsers. While a custom theme is active it sets the
// design tokens inline on <html> and decides light vs. dark itself from the
// base color's luminance, so the toggle steps aside.
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Moon, Palette, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { THEME_VAR_NAMES, isDarkTheme, parseLinearTheme, themeVars } from "@/lib/linearstyle";
import { ThemeContext, useTheme } from "@/lib/theme-context";

const DARK_KEY = "rt-theme";
// A cache of the server's value so the first paint already wears the theme;
// the GET on mount is the reconciliation, the PUT is the write.
const CUSTOM_KEY = "rt-linear-theme";

function readCache(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeCache(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode); the server still has it.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    const stored = readCache(DARK_KEY);
    return stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [customRaw, setCustomRaw] = useState(() => readCache(CUSTOM_KEY));
  const custom = useMemo(() => (customRaw ? parseLinearTheme(customRaw) : null), [customRaw]);

  // Apply before paint: a custom theme owns the tokens and the dark class;
  // without one the tokens fall back to the stylesheet and the toggle rules.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (custom) {
      for (const [k, v] of Object.entries(themeVars(custom))) root.style.setProperty(k, v);
      root.classList.toggle("dark", isDarkTheme(custom));
      return;
    }
    for (const k of THEME_VAR_NAMES) root.style.removeProperty(k);
    root.classList.toggle("dark", dark);
  }, [custom, dark]);

  // Reconcile the cache with sqlite, which is the source of truth.
  useEffect(() => {
    void (async () => {
      try {
        const t = await api.theme();
        writeCache(CUSTOM_KEY, t.linear);
        setCustomRaw(t.linear);
      } catch {
        // Offline or the server is restarting: keep the cached theme.
      }
    })();
  }, []);

  const toggle = useCallback(() => {
    setDark((d) => {
      writeCache(DARK_KEY, d ? "light" : "dark");
      return !d;
    });
  }, []);

  const setCustom = useCallback(async (raw: string) => {
    const t = await api.putTheme({ linear: raw });
    writeCache(CUSTOM_KEY, t.linear);
    setCustomRaw(t.linear);
  }, []);

  const value = useMemo(() => ({ dark, toggle, custom, setCustom }), [dark, toggle, custom, setCustom]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { dark, toggle, custom } = useTheme();
  if (custom)
    return (
      <Button
        variant="quiet"
        size="iconSm"
        onClick={() => {
          window.location.hash = "/settings";
        }}
        aria-label="Custom theme active — change it in Settings"
        title="Custom theme active — change it in Settings"
      >
        <Palette />
      </Button>
    );
  return (
    <Button variant="quiet" size="iconSm" onClick={toggle} aria-label="Toggle theme">
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
