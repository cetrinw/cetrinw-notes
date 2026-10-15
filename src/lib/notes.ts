import { save } from "./db";
export async function createNote(title = "未命名笔记", markdown = "") {
  return save({
    kind: "note",
    title,
    data: { folder: "收件箱", tags: [], markdown, attachments: [] },
  });
}
