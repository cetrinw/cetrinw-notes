import type { Entry } from "../types";

const escapeInline = (text: string) =>
  text.replace(/([\\`*_[\]<>])/g, "\\$1");

function inline(nodes: any[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => {
      if (n.type === "text") {
        let text = escapeInline(String(n.text ?? ""));
        const marks: any[] = n.marks || [];
        for (const mark of marks) {
          if (mark.type === "bold") text = `**${text}**`;
          else if (mark.type === "italic") text = `*${text}*`;
          else if (mark.type === "strike") text = `~~${text}~~`;
          else if (mark.type === "code") text = `\`${text}\``;
          else if (mark.type === "link")
            text = `[${text}](${mark.attrs?.href || ""})`;
        }
        return text;
      }
      if (n.type === "noteReference")
        return `[${n.attrs?.label || "笔记"}](cetrinw://note/${n.attrs?.noteId || ""})`;
      if (n.type === "image")
        return `![${n.attrs?.alt || n.attrs?.assetHash || "图片"}](assets/${n.attrs?.assetHash || n.attrs?.src || ""})`;
      if (n.type === "inlineMath") return `$${n.attrs?.latex || ""}$`;
      return inline(n.content);
    })
    .join("");
}

function block(nodes: any[] | undefined, depth = 0): string {
  if (!nodes) return "";
  const parts: string[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, n.attrs?.level || 1));
        parts.push(`${"#".repeat(level)} ${inline(n.content)}`);
        break;
      }
      case "paragraph":
        parts.push(inline(n.content));
        break;
      case "bulletList":
        parts.push(
          (n.content || [])
            .map(
              (li: any) =>
                `- ${block(li.content, depth).replace(/\n/g, "\n  ")}`,
            )
            .join("\n"),
        );
        break;
      case "orderedList":
        parts.push(
          (n.content || [])
            .map(
              (li: any, i: number) =>
                `${i + 1}. ${block(li.content, depth).replace(/\n/g, "\n   ")}`,
            )
            .join("\n"),
        );
        break;
      case "taskList":
        parts.push(
          (n.content || [])
            .map(
              (li: any) =>
                `- [${li.attrs?.checked ? "x" : " "}] ${block(li.content, depth)}`,
            )
            .join("\n"),
        );
        break;
      case "blockquote":
        parts.push(
          block(n.content, depth)
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n"),
        );
        break;
      case "codeBlock":
        parts.push(
          `\`\`\`\n${(n.content || []).map((c: any) => c.text || "").join("")}\n\`\`\``,
        );
        break;
      case "horizontalRule":
        parts.push("---");
        break;
      case "details": {
        const summary = (n.content || []).find(
          (c: any) => c.type === "detailsSummary",
        );
        const body = (n.content || []).find(
          (c: any) => c.type === "detailsContent",
        );
        parts.push(
          `<details><summary>${inline(summary?.content) || "详细内容"}</summary>\n\n${block(body?.content, depth)}\n\n</details>`,
        );
        break;
      }
      case "table": {
        const rows: any[] = n.content || [];
        const render = (row: any) =>
          `| ${(row.content || [])
            .map((cell: any) => block(cell.content, depth).replace(/\n/g, " "))
            .join(" | ")} |`;
        const [head, ...body] = rows;
        if (head) {
          const cols = (head.content || []).length;
          parts.push(
            [
              render(head),
              `| ${Array(cols).fill("---").join(" | ")} |`,
              ...body.map(render),
            ].join("\n"),
          );
        }
        break;
      }
      case "metricBlock":
        parts.push(`[动态指标](cetrinw://series/${n.attrs?.seriesId || ""})`);
        break;
      case "noteReference":
        parts.push(inline([n]));
        break;
      case "image":
        parts.push(inline([n]));
        break;
      default:
        if (n.content) parts.push(block(n.content, depth));
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

/** Converts a note record into Markdown without opening the editor: stored
 * markdown wins, otherwise the rich-text JSON is serialized with a small
 * converter that covers the blocks this app can create. */
export function noteToMarkdown(entry: Entry): string {
  const stored = entry.data?.markdown;
  if (typeof stored === "string" && stored.trim()) return stored;
  const content = entry.data?.content;
  if (!content) return "";
  return block(content.content || []);
}
