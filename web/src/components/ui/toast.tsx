// Minimal toast system with an optional Undo action.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  text: string;
  tone: "default" | "error";
  onUndo?: () => void;
  action?: { label: string; onClick: () => void };
}

interface ToastCtx {
  toast: (
    text: string,
    opts?: { tone?: "default" | "error"; onUndo?: () => void; action?: { label: string; onClick: () => void } },
  ) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback<ToastCtx["toast"]>((text, opts) => {
    const id = ++idRef.current;
    setToasts((t) => [
      ...t.slice(-2),
      { id, text, tone: opts?.tone ?? "default", onUndo: opts?.onUndo, action: opts?.action },
    ]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.tone === "error" ? 6000 : 3500);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-16 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-center gap-3 rounded-full border px-4 py-2 text-sm shadow-pop anim-pop-in",
              t.tone === "error"
                ? "border-destructive/40 bg-destructive/10 text-destructive backdrop-blur-xl"
                : "border-border bg-popover/95 backdrop-blur-xl",
            )}
          >
            <span className="max-w-[420px] truncate">{t.text}</span>
            {t.onUndo && (
              <button
                onClick={t.onUndo}
                className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <Undo2 className="size-3.5" /> Undo
              </button>
            )}
            {t.action && (
              <button
                onClick={t.action.onClick}
                className="cursor-pointer text-xs font-semibold text-primary hover:underline"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
