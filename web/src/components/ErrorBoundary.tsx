// A render crash anywhere below must not blank the whole app: show what
// broke, keep a way back, and let the operator recover without losing the
// session's notices by reloading only on request.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Rapid Triage render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-screen items-start justify-center px-5 py-[12vh]">
        <div className="surface-card w-full max-w-lg rounded-2xl p-6">
          <div className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="size-5" />
            <h1 className="font-display text-lg font-bold tracking-tight">Something broke while rendering</h1>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            The triage view hit an unexpected error. Your queue, macros, and enrichments are stored
            server-side and are unaffected.
          </p>
          <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[11px] text-muted-foreground">
            {String(error?.message ?? error)}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button variant="quiet" size="sm" onClick={() => window.location.reload()}>
              <RefreshCw /> Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
