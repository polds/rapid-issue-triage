// Hash-based page switch (triage | macros | reports) — no router dependency,
// deep links work through the Go server's SPA fallback.
import { useEffect, useState } from "react";
import { TriageProvider } from "@/lib/store";
import { TopBar } from "@/components/triage/TopBar";
import { TicketSearch } from "@/components/triage/TicketSearch";
import { TriagePage } from "@/pages/Triage";
import { MacrosPage } from "@/pages/Macros";
import { ReportsPage } from "@/pages/Reports";
import { SettingsPage } from "@/pages/Settings";

function pageFromHash(): string {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "macros" || h === "reports") return h;
  // Settings has sub-pages under #/settings/<section>; they all render the
  // SettingsPage shell, which reads the section from the hash itself.
  if (h === "settings" || h.startsWith("settings/")) return "settings";
  return "triage";
}

// isTyping: is the key going into a text field? `G` must not fire while the
// user types a search term, a macro name, or an API key.
function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export default function App() {
  const [page, setPage] = useState(pageFromHash);
  // Go to issue lives here, not on the triage page: the TopBar button and the
  // `G` shortcut work from every page, and a pull lands the user on the deck.
  const [goTo, setGoTo] = useState(false);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "g" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      // Another picker or dialog owns the keyboard (or this one is already up).
      if (document.querySelector("[data-picker-open]")) return;
      e.preventDefault();
      setGoTo(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = (p: string) => {
    window.location.hash = p === "triage" ? "/" : `/${p}`;
  };

  return (
    <TriageProvider>
      <div className="flex min-h-screen flex-col grid-backdrop">
        <TopBar page={page} navigate={navigate} onGoTo={() => setGoTo(true)} />
        {page === "triage" && <TriagePage />}
        {page === "macros" && <MacrosPage />}
        {page === "reports" && <ReportsPage />}
        {page === "settings" && <SettingsPage />}
        {goTo && (
          <TicketSearch
            onClose={() => setGoTo(false)}
            onPulled={() => {
              setGoTo(false);
              navigate("triage");
            }}
          />
        )}
      </div>
    </TriageProvider>
  );
}
