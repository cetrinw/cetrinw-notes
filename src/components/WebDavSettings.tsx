import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Cloud, Check, UploadCloud, RefreshCw } from "lucide-react";
import { setting, setSetting, native } from "../lib/db";
import { webdav } from "../lib/cloud";
import { ErrorBox, Field, Modal } from "./ui";

export default function WebDavSettings() {
  const [config, setConfig] = useState({
      url: "https://dav.jianguoyun.com/dav/",
      username: "",
      autoBackup: false,
    }),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [files, setFiles] = useState<any[] | null>(null),
    [preview, setPreview] = useState<any>(null),
    [last, setLast] = useState<any>(null);
  useEffect(() => {
    void setting<any>("webdav_config").then((v) => {
      if (v) setConfig(v);
    });
    void setting("webdav_last_backup").then(setLast);
    void setting<string>("webdav_error").then((v) => setError(v || ""));
  }, []);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface settings-section">
      <div className="settings-icon">
        <Cloud size={22} />
      </div>
      <div className="settings-body">
        <h3>坚果云 / WebDAV 完整备份</h3>
        <p className="muted">
          一次备份笔记、研究资料、订阅文章、附件、课程与学习进度。备份以独立时间戳文件保存，不覆盖已有云端文件。
        </p>
        <div className="two-col compact">
          <Field label="WebDAV 根地址">
            <input
              type="url"
              value={config.url}
              onChange={(e) => setConfig({ ...config, url: e.target.value })}
            />
          </Field>
          <Field label="账号">
            <input
              value={config.username}
              onChange={(e) =>
                setConfig({ ...config, username: e.target.value })
              }
              placeholder="坚果云登录邮箱"
            />
          </Field>
        </div>
        <Field
          label="应用授权密码"
          hint="坚果云：账户信息 → 安全选项 → 第三方应用管理 → 添加应用密码。保存到 Mac 系统钥匙串；留空保留已保存密码。"
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="粘贴应用密码，不是登录密码"
            autoComplete="new-password"
          />
        </Field>
        <label className="inline">
          <input
            type="checkbox"
            checked={config.autoBackup}
            onChange={(e) =>
              setConfig({ ...config, autoBackup: e.target.checked })
            }
          />
          应用打开时，每天自动备份一次
        </label>
        <p className="muted small">
          云端目录：Cetrinw/。备份包含原始资料，选择你信任的云盘；此功能不合并多设备同时编辑，实时同步请使用上方的个人服务器。
        </p>
        <div className="inline wrap">
          <button
            className="primary"
            disabled={busy || !native}
            onClick={() =>
              void task(async () => {
                if (password) {
                  await invoke("secret_set", {
                    account: "webdav-password",
                    token: password,
                  });
                  setPassword("");
                }
                await setSetting("webdav_config", config);
                setMessage("配置已保存。请测试连接后执行第一次备份。");
              })
            }
          >
            <Check size={14} />
            保存配置
          </button>
          <button
            className="soft-button"
            disabled={busy || !native}
            onClick={() =>
              void task(async () => {
                const r = await webdav("test");
                setMessage(r.message);
              })
            }
          >
            测试已保存连接
          </button>
          <button
            className="soft-button"
            disabled={busy || !native}
            onClick={() =>
              void task(async () => {
                const r = await webdav("backup");
                setLast(r);
                setMessage(`备份已上传：${r.name}`);
              })
            }
          >
            <UploadCloud size={15} />
            立即完整备份
          </button>
          <button
            className="soft-button"
            disabled={busy || !native}
            onClick={() =>
              void task(async () => {
                const r = await webdav("list");
                setFiles(r);
                setMessage(
                  r.length
                    ? `找到 ${r.length} 个备份`
                    : "云端 Cetrinw 目录中还没有备份",
                );
              })
            }
          >
            <RefreshCw size={14} />
            云端备份列表
          </button>
        </div>
        {!native && (
          <p className="form-hint">
            请在 Mac 应用中配置此连接；浏览器预览不会保存云盘密码。
          </p>
        )}
        {last && (
          <p className="muted small">
            最近上传：{new Date(last.uploadedAt).toLocaleString("zh-CN")} ·{" "}
            {(last.size / 1024 / 1024).toFixed(2)} MB
          </p>
        )}
        {message && (
          <p role="status" className="success-box">
            {message}
          </p>
        )}
        <ErrorBox message={error} />
        {files?.map((f) => (
          <div className="source-discovery" key={f.name}>
            <span>
              {f.name}
              <small>
                {(f.size / 1024 / 1024).toFixed(2)} MB · {f.modified}
              </small>
            </span>
            <button
              className="soft-button"
              disabled={busy}
              onClick={() =>
                void task(async () =>
                  setPreview({
                    ...(await webdav("preview", f.name)),
                    name: f.name,
                  }),
                )
              }
            >
              查看并恢复
            </button>
          </div>
        ))}
        <p className="muted small">
          <a
            href="https://help.jianguoyun.com/?p=2064"
            target="_blank"
            rel="noreferrer"
          >
            坚果云官方 WebDAV 开启说明
          </a>
          。免费账户有流量和请求限制，当前上限以官方账户页面为准。
        </p>
        <p className="muted small">
          Notion 的笔记交换、Google Drive OAuth 连接尚未接入。Google
          Drive、OneDrive
          或国内云盘若提供本地同步文件夹，可以先把“导出完整备份”保存到该目录，由其官方客户端上传。
        </p>
        {preview && (
          <Modal title="恢复云端备份" onClose={() => setPreview(null)}>
            <p>{preview.name}</p>
            <p>
              创建时间：{preview.createdAt} · {preview.records} 条记录 ·{" "}
              {preview.assets} 个附件
            </p>
            <ul>
              {preview.titles.map((t: string, i: number) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <p className="muted">
              导入会合并到当前资料库：相同内容跳过，冲突内容另存副本，现有笔记保留。
            </p>
            <div className="modal-actions">
              <button className="soft-button" onClick={() => setPreview(null)}>
                取消
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void task(async () => {
                    const r = await webdav("restore", preview.name);
                    setMessage(
                      `已导入 ${r.imported} 条记录，附件 ${r.assets} 个`,
                    );
                    setPreview(null);
                  })
                }
              >
                确认合并此备份
              </button>
            </div>
          </Modal>
        )}
      </div>
    </section>
  );
}
