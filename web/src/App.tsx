// Hash-based page switch (triage | macros | reports) — no router dependency,
// deep links work through the Go server's SPA fallback.
import { useEffect, useState } from "react";
import { TriageProvider } from "@/lib/store";
import { TopBar } from "@/components/triage/TopBar";
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

export default function App() {
  const [page, setPage] = useState(pageFromHash);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (p: string) => {
    window.location.hash = p === "triage" ? "/" : `/${p}`;
  };

  return (
    <TriageProvider>
      <div className="flex min-h-screen flex-col grid-backdrop">
        <TopBar page={page} navigate={navigate} />
        {page === "triage" && <TriagePage />}
        {page === "macros" && <MacrosPage />}
        {page === "reports" && <ReportsPage />}
        {page === "settings" && <SettingsPage />}
      </div>
    </TriageProvider>
  );
}
