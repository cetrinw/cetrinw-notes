import { describe, it, expect } from "vitest";
import { noteToMarkdown } from "./markdown";

const entry = (data: any) =>
  ({
    id: "n",
    kind: "note",
    title: "测试",
    data,
    revision: 1,
    updated_at: "",
    deleted: false,
    conflict_of: null,
  }) as any;

describe("note markdown export", () => {
  it("prefers stored markdown", () => {
    expect(noteToMarkdown(entry({ markdown: "# 已存 Markdown" }))).toBe(
      "# 已存 Markdown",
    );
  });
  it("serializes rich-text content with common blocks", () => {
    const md = noteToMarkdown(
      entry({
        content: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "标题" }],
            },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "正文", marks: [{ type: "bold" }] },
              ],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "第一项" }],
                    },
                  ],
                },
              ],
            },
            { type: "noteReference", attrs: { noteId: "abc", label: "关联笔记" } },
          ],
        },
      }),
    );
    expect(md).toContain("## 标题");
    expect(md).toContain("**正文**");
    expect(md).toContain("- 第一项");
    expect(md).toContain("[关联笔记](cetrinw://note/abc)");
  });
  it("returns an empty string for notes without content", () => {
    expect(noteToMarkdown(entry({}))).toBe("");
  });
});
