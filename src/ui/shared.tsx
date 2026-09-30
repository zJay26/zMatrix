import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, AlertCircle, MoreHorizontal } from "lucide-react";
import { messageOf } from "../core/model";
import type { ChannelId } from "../core/model";
import { channelFor } from "../platforms/catalog";
import { isExtension } from "../platforms/browser-adapter";
import { sendWorkbenchCommand } from "../core/commands";
export const timeLabel = (time?: number) =>
  time
    ? new Date(time).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "尚未同步";
export function PlatformPill({ id }: { id: ChannelId }) {
  const platform = channelFor(id);
  return (
    <span className="platform-pill">
      <i style={{ background: platform.color }} />
      {platform.short}
    </span>
  );
}
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      <AlertCircle size={17} />
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-mark">稿</div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
        ) ?? [],
      ).filter((node) => node.getClientRects().length);
    (focusable()[0] ?? dialog.current)?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const targets = focusable();
        const first = targets[0],
          last = targets.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      active?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button aria-label="关闭对话框" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const value = URL.createObjectURL(blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return url;
}
export function ActionMenu({
  children,
  label = "更多操作",
}: {
  children: ReactNode;
  label?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <details
      className="action-menu"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label} title={label}>
        <MoreHorizontal size={18} />
      </summary>
      <div
        className="action-menu-items"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button,a") && menu.current)
            menu.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
export function ConfirmDialog({
  title,
  children,
  confirmLabel = "确认删除",
  onConfirm,
  onClose,
  danger = true,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="confirm-copy">{children}</div>
      {error && <Alert>{error}</Alert>}
      <footer className="modal-actions">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className={danger ? "danger" : "primary"}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void onConfirm()
              .then(onClose)
              .catch((e) => setError(messageOf(e)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "正在处理…" : confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
export async function command(message: unknown) {
  if (!isExtension())
    throw new Error("这是本地界面预览。请在 Edge 中加载扩展后操作平台。");
  return sendWorkbenchCommand(message);
}
