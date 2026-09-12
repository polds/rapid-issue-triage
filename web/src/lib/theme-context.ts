// The theme context object and hook, split from theme.tsx so that file
// exports only components (react-refresh/only-export-components).
import { createContext, useContext } from "react";
import type { LinearTheme } from "./linearstyle";

export interface ThemeCtx {
  dark: boolean;
  toggle: () => void;
  // The active Linear-style override, or null for the built-in palette.
  custom: LinearTheme | null;
  // Persist a Linear theme string ("" clears it). Rejects with the server's
  // message when the string is not six hex colors.
  setCustom: (raw: string) => Promise<void>;
}

export const ThemeContext = createContext<ThemeCtx>({
  dark: false,
  toggle: () => {},
  custom: null,
  setCustom: () => Promise.resolve(),
});

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext);
}
