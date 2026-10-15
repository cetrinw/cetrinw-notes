import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Languages, ArrowDownToLine } from "lucide-react";
import { learningCommand, native } from "../lib/db";
import { ErrorBox, Field } from "./ui";

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function TranslateSettings() {
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sample, setSample] = useState("Could you explain the supply chain?");
  const [result, setResult] = useState("");
  useEffect(() => {
    if (!native) return;
    void invoke<any>("translate_model_status")
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <section className="surface settings-section">
      <div className="settings-icon">
        <Languages size={22} />
      </div>
      <div className="settings-body">
        <h3>离线翻译</h3>
        <p className="muted">
          课文与新闻的中文对照优先使用本地模型，重复句子自动走缓存；模型未就绪时使用
          MyMemory 公共接口兜底。
        </p>
        {!native ? (
          <p className="form-hint">
            离线模型在 Mac
            应用中管理；浏览器预览使用个人服务器上配置的模型目录。
          </p>
        ) : (
          <>
            {status && (
              <p className="muted small">
                模型状态：
                {status.ready
                  ? `已就绪 · ${formatBytes(status.bytes)}`
                  : status.bytes > 0
                    ? `下载未完成 · 已有 ${formatBytes(status.bytes)}`
                    : "尚未下载"}
                {!status.engineCompiled && " · 当前构建未包含推理引擎"}
              </p>
            )}
            <div className="inline wrap">
              <button
                className="soft-button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  setMessage("");
                  void invoke<any>("translate_model_download")
                    .then((s) => {
                      setStatus(s);
                      setMessage(
                        s.ready
                          ? `模型已就绪 · ${formatBytes(s.bytes)}`
                          : "下载完成但文件不完整，请重试",
                      );
                    })
                    .catch((e) => setError(String(e)))
                    .finally(() => setBusy(false));
                }}
              >
                <ArrowDownToLine size={15} />
                {busy
                  ? "正在下载模型…"
                  : status?.ready
                    ? "重新校验模型"
                    : "下载离线模型（首次约 150 MB）"}
              </button>
            </div>
          </>
        )}
        <Field label="试译一句英文">
          <div className="inline">
            <input value={sample} onChange={(e) => setSample(e.target.value)} />
            <button
              className="soft-button"
              disabled={!sample.trim()}
              onClick={() => {
                setError("");
                setResult("");
                void learningCommand({
                  op: "learning_translate",
                  text: sample.trim(),
                })
                  .then((r: any) => setResult(`${r.text} · ${r.provider}`))
                  .catch((e) => setError(String(e)));
              }}
            >
              翻译
            </button>
          </div>
        </Field>
        {result && (
          <p role="status" className="success-box">
            {result}
          </p>
        )}
        <ErrorBox message={error} />
        {message && <p className="muted small">{message}</p>}
      </div>
    </section>
  );
}
