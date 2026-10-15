import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import type { Entry, Kind, Asset } from "../types";
import { zipSync, strToU8 } from "fflate";
export const native = isTauri();
export async function learningCommand(request: object) {
  const result = native
    ? await invoke<any>("learning_command", { request })
    : await command(request);
  if ((request as any).op === "learning_download") changed("lesson");
  if ((request as any).op === "news_refresh") changed("article");
  return result;
}
export async function command<T = any>(request: object): Promise<T> {
  if (native) return invoke<T>("db_command", { request });
  const response = await fetch("/v1/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
export function changed(kind?: Kind) {
  window.dispatchEvent(new CustomEvent("cetrinw-change", { detail: kind }));
}
export const list = (
  kind: Kind | "" = "",
  query = "",
  limit = 200,
  offset = 0,
) => command<Entry[]>({ op: "list", kind, query, limit, offset });
export const get = (id: string) => command<Entry | null>({ op: "get", id });
export async function save(
  input: Partial<Entry> & { kind: Kind; title: string; data: any },
) {
  const r = await command<Entry>({ op: "save", record: input });
  changed(r.kind);
  return r;
}
export async function remove(id: string) {
  const r = await command<Entry>({ op: "delete", id });
  changed(r.kind);
  return r;
}
export const setting = <T>(key: string) =>
  command<T | null>({ op: "setting_get", key });
export const setSetting = (key: string, value: unknown) =>
  command({ op: "setting_set", key, value });
export async function upload(file: File): Promise<Asset> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return command({
    op: "asset_put",
    name: file.name,
    mime: file.type || "application/octet-stream",
    base64,
  });
}
const assetUrls = new Map<string, string>();
export async function assetUrl(
  asset: Pick<Asset, "hash" | "mime">,
): Promise<string> {
  if (assetUrls.has(asset.hash)) return assetUrls.get(asset.hash)!;
  let result: string;
  if (native)
    result = convertFileSrc(
      await command<string>({ op: "asset_path", hash: asset.hash }),
    );
  else {
    const response = await fetch(`/v1/assets/${asset.hash}`);
    if (!response.ok) throw new Error("附件尚未下载");
    result = URL.createObjectURL(
      new Blob([await response.arrayBuffer()], { type: asset.mime }),
    );
  }
  assetUrls.set(asset.hash, result);
  return result;
}
export async function download(
  name: string,
  content: BlobPart,
  type = "application/json",
) {
  if (native) {
    const bytes = Array.from(
      new Uint8Array(await new Blob([content], { type }).arrayBuffer()),
    );
    // The save dialog runs in Rust, so the webview never chooses a filesystem
    // path; it only suggests a name. Returns false when the user cancels.
    return await invoke<boolean>("write_export", { name, bytes });
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function markdownBundle(note: Entry, markdown: string) {
  const entries: Record<string, Uint8Array> = {};
  let snapshots = "";
  const walk = async (node: any): Promise<void> => {
    if (node?.type === "metricBlock") {
      const series = await get(node.attrs.seriesId);
      const points = series?.data.points || [];
      const latest = [...points]
        .sort((a, b) => a.date.localeCompare(b.date))
        .at(-1);
      snapshots += `\n\n### 指标快照：${series?.title || node.attrs.seriesId}\n\n${latest ? `${latest.date}：${latest.close ?? latest.value} ${series?.data.unit || ""}` : "暂无有效数据"}\n\n来源：${series?.data.sourceUrl || "未记录"}\n`;
    }
    for (const child of node?.content || []) await walk(child);
  };
  await walk(note.data.content);
  const safe = note.title.replace(/[\\/:*?"<>|]/g, "_") || "笔记";
  entries[`${safe}.md`] = strToU8(markdown + snapshots);
  entries["rich-document.json"] = strToU8(JSON.stringify(note, null, 2));
  entries["README.txt"] = strToU8(
    "Markdown 是可读交换格式。合并表格、公式、自定义块与引用的完整结构保留在 rich-document.json。assets 目录保留原始附件。动态指标附有导出时的静态快照。",
  );
  for (const asset of note.data.attachments || []) {
    const { base64 } = await command({ op: "asset_get", hash: asset.hash });
    entries[`assets/${asset.hash}`] = Uint8Array.from(atob(base64), (c) =>
      c.charCodeAt(0),
    );
  }
  const bytes = zipSync(entries, { level: 1 });
  return download(
    `${safe}.zip`,
    bytes.buffer as ArrayBuffer,
    "application/zip",
  );
}

const flushers = new Set<() => Promise<unknown>>();
export function registerFlush(fn: () => Promise<unknown>) {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}
export async function flushPending() {
  for (const flush of flushers) await flush();
}
const dirtyChecks = new Set<() => boolean>();
/** Editors register a synchronous "has unsaved edits" check for beforeunload. */
export function registerDirty(fn: () => boolean) {
  dirtyChecks.add(fn);
  return () => {
    dirtyChecks.delete(fn);
  };
}
export function anyDirty() {
  for (const fn of dirtyChecks) {
    try {
      if (fn()) return true;
    } catch {
      /* a broken check must not block unload prompts */
    }
  }
  return false;
}
export async function dictionary(word: string) {
  if (native) return invoke<any>("dictionary_lookup", { word });
  return command({ op: "dictionary", word });
}
let sessionToken = "";
export async function setToken(token: string) {
  sessionToken = token;
  if (native) await invoke("secret_set", { token });
}
export async function remote(request: object) {
  const url = await setting<string>("server_url");
  if (!url) throw new Error("请先在设置中填写个人服务器地址");
  if (native) {
    if (!sessionToken) sessionToken = await invoke<string>("secret_get");
    return invoke<any>("remote_command", { url, token: sessionToken, request });
  }
  const response = await fetch(`${url.replace(/\/$/, "")}/v1/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify(request),
  });
  const r = await response.json();
  if (!response.ok) throw new Error(r.error || "服务器请求失败");
  return r;
}
let syncing: Promise<{ pushed: number; pulled: number }> | null = null;
export function synchronize() {
  if (syncing) return syncing;
  syncing = (async () => {
    // Immutable attachments are sent before records that reference them.
    const local = await command<Asset[]>({ op: "asset_list" });
    const remoteAssets = (await remote({ op: "asset_list" })) as Asset[];
    const remoteHashes = new Set(remoteAssets.map((a) => a.hash));
    for (const a of local) {
      if (!remoteHashes.has(a.hash)) {
        const bytes = await command({ op: "asset_get", hash: a.hash });
        await remote({ op: "asset_put", ...a, ...bytes });
      }
    }
    let pushed = 0,
      pulled = 0;
    for (const entry of await command<any[]>({ op: "outbox" })) {
      const ack = await remote({ op: "sync_push", ...entry });
      await command({ op: "sync_ack", ack });
      pushed++;
    }
    let cursor = (await setting<number>("sync_cursor")) || 0;
    for (let page = 0; page < 10000; page++) {
      const changes = await remote({ op: "changes", cursor });
      await command({
        op: "sync_apply",
        records: changes.records,
        cursor: changes.cursor,
      });
      pulled += changes.records.length;
      cursor = changes.cursor;
      if (!changes.more) break;
    }
    const localHashes = new Set(local.map((a) => a.hash));
    for (const a of remoteAssets) {
      if (!localHashes.has(a.hash)) {
        const bytes = await remote({ op: "asset_get", hash: a.hash });
        await command({ op: "asset_put", ...a, ...bytes });
      }
    }
    await setSetting("last_sync", new Date().toISOString());
    changed();
    return { pushed, pulled };
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}
