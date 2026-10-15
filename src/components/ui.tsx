import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, ArrowUpRight, Loader2 } from "lucide-react";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = panel.current;
    const previous = document.activeElement as HTMLElement | null;
    const first =
      node?.querySelector<HTMLElement>(
        "input:not([type=hidden]):not([type=file]), textarea, select",
      ) ||
      node?.querySelector<HTMLElement>(
        "[href], button:not([aria-label='关闭'])",
      );
    if (first && !node?.contains(document.activeElement)) first.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only the topmost dialog answers Escape.
      const open = document.querySelectorAll(".modal-backdrop");
      if (open[open.length - 1] !== node?.parentElement) return;
      e.stopPropagation();
      close.current();
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon || <ArrowUpRight />}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error-box" role="alert">
      {message}
    </div>
  ) : null;
}
export function Busy({ text = "正在加载" }: { text?: string }) {
  return (
    <span className="muted inline">
      <Loader2 className="spin" size={15} />
      {text}
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
/** In-app replacement for window.confirm: keyboard reachable, focus managed,
 * and errors from the confirmed action stay visible inside the dialog. */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "确认",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <p className="confirm-message">{message}</p>
      <ErrorBox message={error} />
      <div className="modal-actions">
        <button className="soft-button" onClick={onClose}>
          取消
        </button>
        <button
          className={danger ? "primary danger-solid" : "primary"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "处理中…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
/** In-app replacement for window.prompt with inline validation. */
export function PromptModal({
  title,
  label,
  defaultValue = "",
  placeholder,
  hint,
  multiline = false,
  submitLabel = "确定",
  validate,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  submitLabel?: string;
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const invalid = validate?.(value);
          if (invalid) {
            setError(invalid);
            return;
          }
          setBusy(true);
          try {
            await onSubmit(value);
            onClose();
          } catch (err) {
            setError(String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={label} hint={hint}>
          {multiline ? (
            <textarea
              rows={3}
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <input
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
        <ErrorBox message={error} />
        <div className="modal-actions">
          <button type="button" className="soft-button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "处理中…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
