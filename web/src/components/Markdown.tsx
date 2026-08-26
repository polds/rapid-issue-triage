// Tiny dependency-free markdown renderer covering what Linear descriptions
// typically use: headers, bullet/numbered lists, bold, inline code, links,
// fenced code blocks. Not a full spec implementation on purpose.
import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)/g).filter(Boolean);
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
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {link[1]}
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
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushList = () => {
    if (!list) return;
    const L = list.ordered ? "ol" : "ul";
    blocks.push(
      <L
        key={`l${blocks.length}`}
        className={`ml-5 space-y-1 text-sm text-muted-foreground ${list.ordered ? "list-decimal" : "list-disc"}`}
      >
        {list.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
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
      code = [];
      return;
    }
    const ol = line.match(/^\d+\.\s+(.*)/);
    const ul = line.match(/^[-*]\s+(.*)/);
    if (ol || ul) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ol ?? ul)![1]);
      return;
    }
    flushList();
    if (!line.trim()) return;
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

  return <div className="space-y-2.5">{blocks}</div>;
}
