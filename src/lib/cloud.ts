import { invoke } from "@tauri-apps/api/core";
import { changed, flushPending, native, setSetting, setting } from "./db";

let backingUp: Promise<any> | null = null;
export async function webdav(action: string, name?: string) {
  if (!native)
    throw new Error("WebDAV 连接在 Mac 客户端中使用，密码保存在系统钥匙串");
  if (action === "backup") {
    if (backingUp) return backingUp;
    backingUp = (async () => {
      await flushPending();
      await setSetting("webdav_last_attempt", new Date().toISOString());
      try {
        const result = await invoke("webdav_command", { action, name });
        await setSetting("webdav_error", null);
        return result;
      } catch (e) {
        await setSetting("webdav_error", String(e));
        throw e;
      }
    })().finally(() => {
      backingUp = null;
    });
    return backingUp;
  }
  const result = await invoke<any>("webdav_command", { action, name });
  if (action === "restore") changed();
  return result;
}
export function startCloudBackupScheduler() {
  if (!native) return () => {};
  const tick = async () => {
    const config = await setting<any>("webdav_config");
    if (!config?.autoBackup) return;
    const last = await setting<any>("webdav_last_backup"),
      attempt = await setting<string>("webdav_last_attempt");
    if (
      last?.uploadedAt &&
      new Date(last.uploadedAt).toLocaleDateString() ===
        new Date().toLocaleDateString()
    )
      return;
    if (attempt && Date.now() - new Date(attempt).getTime() < 3600000) return;
    try {
      await webdav("backup");
    } catch {
      /* The actual error is retained in Settings. */
    }
  };
  const first = setTimeout(() => void tick(), 10000),
    timer = setInterval(() => void tick(), 3600000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
