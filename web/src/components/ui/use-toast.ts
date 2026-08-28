// The toast context and its accessor hook. Kept apart from toast.tsx so that
// module exports only components and stays fast-refresh friendly.
import { createContext, useContext } from "react";

export interface ToastCtx {
  toast: (
    text: string,
    opts?: { tone?: "default" | "error"; onUndo?: () => void; action?: { label: string; onClick: () => void } },
  ) => void;
}

export const ToastContext = createContext<ToastCtx>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);
