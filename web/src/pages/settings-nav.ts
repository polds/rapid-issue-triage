// Settings sub-page routing. Kept apart from Settings.tsx so that module
// exports only components (react-refresh/only-export-components is an error).
//
// Each section is a deep-linkable hash under #/settings/<id>; the sidebar
// switches between them and the browser back button works. `settings` with no
// section falls through to the first entry.
import { useEffect, useState } from "react";

export type SettingsSection = "enrichment" | "appearance" | "data" | "about";

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string; blurb: string }[] = [
  { id: "enrichment", label: "Enrichment", blurb: "How “Enrich with AI” investigates an issue." },
  { id: "appearance", label: "Appearance", blurb: "The Linear-style custom theme." },
  { id: "data", label: "Data & re-indexing", blurb: "Force a sync or clear local state." },
  { id: "about", label: "About", blurb: "This build and its update check." },
];

const DEFAULT_SECTION: SettingsSection = "enrichment";

function isSection(v: string): v is SettingsSection {
  return SETTINGS_SECTIONS.some((s) => s.id === v);
}

// Parse the section out of the current hash. `#/settings` (no section) and any
// unknown section both resolve to the default.
export function sectionFromHash(): SettingsSection {
  const h = window.location.hash.replace(/^#\/?/, "");
  const rest = h.startsWith("settings/") ? h.slice("settings/".length) : "";
  return isSection(rest) ? rest : DEFAULT_SECTION;
}

export function settingsHref(id: SettingsSection): string {
  return `#/settings/${id}`;
}

// Live section, kept in sync with the hash so deep links and the back button
// both land on the right page.
export function useSettingsSection(): SettingsSection {
  const [section, setSection] = useState(sectionFromHash);
  useEffect(() => {
    const onHash = () => setSection(sectionFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return section;
}
