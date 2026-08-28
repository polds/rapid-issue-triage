# web/src/components/ui/ — primitive kit

Five hand-rolled primitives. Deliberately **not** a component library: the app
ships shadcn-flavoured markup without the dependency, so each file is small
enough to read end to end before changing it.

| File | Role |
|---|---|
| `button.tsx` | `buttonVariants` (class-variance-authority) + `ButtonProps`. |
| `dialog.tsx` | Modal: focus containment, `Esc` to close, backdrop click. |
| `picker.tsx` | **The important one.** Keyboard-first fuzzy picker popover — input on top, arrow-navigable list, `Enter` to select, `Esc` to dismiss. Every `L E C P A X` picker is this. |
| `select.tsx` | Styled *native* `<select>` — the fastest and most accessible dropdown; keep it native. |
| `toast.tsx` | `ToastProvider` + rendering, with an optional Undo action. |
| `use-toast.ts` | `ToastContext` + `useToast`. Split from `toast.tsx` so that module exports only components (`react-refresh/only-export-components` is an error). |

## Invariants

- **Keyboard first.** This app's whole premise is one keystroke per decision.
  A primitive that can only be driven by mouse does not belong here. `picker`
  and `dialog` must handle arrows, `Enter`, `Esc`, and return focus to the
  invoker on close.
- **A picker owns its keystrokes.** While it is open, the page-level shortcut
  handler in `pages/Triage.tsx` must not also fire. That handler bails when an
  `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` element has focus, so a picker
  needs real focus on its input — not a synthetic key trap.
- **Toasts carry the undo affordance.** The triage flow is optimistic: an
  action shows a toast with `onUndo` wired to the server-side undo. Don't add
  a competing confirmation dialog for the same action.
- **Styling is tokens from `src/styles.css`** via Tailwind classes and `cn()`.
  No raw hex, no inline style objects for color.
- Variants go through `class-variance-authority`, not ad-hoc string
  concatenation, so `tailwind-merge` can resolve conflicts.

## Maintenance

Keep this directory primitive: anything that knows about issues, macros, or
enrichment belongs in [`../triage/`](../triage/CLAUDE.md). Adding a file here
means adding a row above. Pair every new primitive with its keyboard story.
