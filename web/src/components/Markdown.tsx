// Tiny dependency-free markdown renderer covering what Linear descriptions
// typically use: headers, bullet/numbered lists, bold, inline code, links,
// fenced code blocks. Not a full spec implementation on purpose.
import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const parts = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+|(?<![\w*])\*[^*\n]+\*(?![\w*])|(?<![\w_])_[^_\n]+_(?![\w_]))/g)
    .filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return (
        <strong key={i} className="font-semibold text-foreground">
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith("`") && p.endsWith("`"))
      return (
        <code key={i} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
          {p.slice(1, -1)}
        </code>
      );
    if ((p.startsWith("*") && p.endsWith("*")) || (p.startsWith("_") && p.endsWith("_")))
      return (
        <em key={i} className="italic">
          {p.slice(1, -1)}
        </em>
      );
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return (
        <a
          key={i}
          href={link[2].replace(/^<|>$/g, "")}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          {inline(link[1])}
        </a>
      );
    if (/^https?:\/\//.test(p))
      return (
        <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
          {p}
        </a>
      );
    return <span key={i}>{p}</span>;
  });
}

export function Markdown({ source }: { source: string }) {
  const lines = (source ?? "").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: { text: string; task: "" | "todo" | "done" }[] } | null = null;
  let code: string[] | null = null;
  let table: string[][] | null = null;

  const flushTable = () => {
    if (!table) return;
    const [head, ...rest] = table;
    const body = rest.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c.trim())));
    blocks.push(
      <div key={`t${blocks.length}`} className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {head.map((c, i) => (
                <th key={i} className="border-b border-border px-2 py-1.5 text-left text-xs font-semibold text-foreground/80">
                  {inline(c.trim())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                {r.map((c, j) => (
                  <td key={j} className="px-2 py-1.5 align-top text-muted-foreground">
                    {inline(c.trim())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = null;
  };

  const flushList = () => {
    if (!list) return;
    const L = list.ordered ? "ol" : "ul";
    const allTasks = list.items.every((it) => it.task);
    blocks.push(
      <L
        key={`l${blocks.length}`}
        className={`space-y-1 text-sm text-muted-foreground ${
          allTasks ? "ml-0 list-none" : `ml-5 ${list.ordered ? "list-decimal" : "list-disc"}`
        }`}
      >
        {list.items.map((item, i) => (
          <li key={i} className={item.task ? "flex items-start gap-2" : undefined}>
            {item.task && (
              <span
                aria-hidden
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                  item.task === "done"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface-2"
                }`}
              >
                {item.task === "done" ? "✓" : ""}
              </span>
            )}
            <span className={item.task === "done" ? "line-through opacity-70" : undefined}>
              {inline(item.text)}
            </span>
          </li>
        ))}
      </L>,
    );
    list = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (code !== null) {
      if (line.startsWith("```")) {
        blocks.push(
          <pre
            key={`c${i}`}
            className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-foreground"
          >
            {code.join("\n")}
          </pre>,
        );
        code = null;
      } else code.push(raw);
      return;
    }
    if (line.startsWith("```")) {
      flushList();
      flushTable();
      code = [];
      return;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList();
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
      (table ??= []).push(cells);
      return;
    }
    flushTable();
    const ol = line.match(/^\s*\d+\.\s+(.*)/);
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    if (ol || ul) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      let text = (ol ?? ul)![1];
      let task: "" | "todo" | "done" = "";
      const t = text.match(/^\[( |x|X)\]\s*(.*)/);
      if (t) {
        task = t[1] === " " ? "todo" : "done";
        text = t[2];
      }
      list.items.push({ text, task });
      return;
    }
    flushList();
    if (!line.trim()) return;
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push(<hr key={i} className="border-border" />);
      return;
    }
    if (/^#{1,4}\s/.test(line)) {
      blocks.push(
        <h4 key={i} className="pt-1 text-xs font-semibold uppercase tracking-wider text-foreground/80">
          {line.replace(/^#+\s*/, "")}
        </h4>,
      );
      return;
    }
    if (line.startsWith(">")) {
      blocks.push(
        <blockquote key={i} className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
          {inline(line.replace(/^>\s?/, ""))}
        </blockquote>,
      );
      return;
    }
    blocks.push(
      <p key={i} className="text-sm leading-relaxed text-muted-foreground">
        {inline(line)}
      </p>,
    );
  });
  flushList();
  flushTable();

  return <div className="space-y-2.5">{blocks}</div>;
}
