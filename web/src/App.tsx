// Hash-based page switch (triage | macros | reports) — no router dependency,
// deep links work through the Go server's SPA fallback.
import { useEffect, useState } from "react";
import { TriageProvider } from "@/lib/store";
import { TopBar } from "@/components/triage/TopBar";
import { TriagePage } from "@/pages/Triage";
import { MacrosPage } from "@/pages/Macros";
import { ReportsPage } from "@/pages/Reports";

function pageFromHash(): string {
  const h = window.location.hash.replace(/^#\/?/, "");
  return h === "macros" || h === "reports" ? h : "triage";
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
      </div>
    </TriageProvider>
  );
}
