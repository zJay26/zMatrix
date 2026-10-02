import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  X,
  AlertCircle,
  MoreHorizontal,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { messageOf } from "../core/model";
import type { ChannelId, PlatformId } from "../core/model";
import { channelFor, platforms } from "../platforms/catalog";
import { isExtension } from "../platforms/browser-adapter";
import { sendWorkbenchCommand } from "../core/commands";
import type { ChannelStatus } from "../core/distribution";
export const timeLabel = (time?: number) =>
  time
    ? new Date(time).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "尚未同步";
export function relativeTime(time?: number) {
  if (!time) return "尚未同步";
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return timeLabel(time);
}
export const untitled = (title?: string) => title?.trim() || "未命名稿件";
export function PlatformIcon({
  id,
  platform,
  size = 22,
}: {
  id?: ChannelId;
  platform?: PlatformId;
  size?: number;
}) {
  const spec = id
    ? channelFor(id)
    : platforms.find((item) => item.id === platform)!;
  return (
    <span
      className="platform-icon"
      aria-hidden="true"
      style={{
        background: spec.color,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.52),
      }}
    >
      {spec.glyph}
    </span>
  );
}
export function PlatformPill({ id }: { id: ChannelId }) {
  return (
    <span className="platform-pill">
      <PlatformIcon id={id} size={18} />
      {channelFor(id).short}
    </span>
  );
}
export function StatusBadge({
  status,
  children,
}: {
  status: ChannelStatus | "ok" | "muted";
  children: ReactNode;
}) {
  return <span className={`badge badge-${status}`}>{children}</span>;
}
// A platform mark carrying the article's state on that platform.
export function ChannelChip({
  id,
  status,
  label,
}: {
  id: ChannelId;
  status: ChannelStatus;
  label: string;
}) {
  const spec = channelFor(id);
  return (
    <span
      className={`channel-chip chip-${status}`}
      title={`${spec.name}：${label}`}
    >
      <PlatformIcon id={id} size={16} />
      <span>{spec.short}</span>
      <i aria-hidden="true" />
      <em>{label}</em>
    </span>
  );
}
export function Alert({
  children,
  tone = "warning",
}: {
  children: ReactNode;
  tone?: "warning" | "danger" | "info";
}) {
  return (
    <div className={`notice notice-${tone}`} role="status">
      <AlertCircle size={17} />
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
  icon: Icon,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty-state">
      <div className="empty-mark">{Icon ? <Icon size={26} /> : "稿"}</div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: readonly { id: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          title={option.title}
          aria-pressed={value === option.id}
          className={value === option.id ? "selected" : ""}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  size,
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  size?: "wide" | "full";
  dismissible?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = () => {
    if (dismissible) onClose();
  };
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
      // Only the topmost dialog reacts when dialogs are stacked.
      const open = document.querySelectorAll('[role="dialog"]');
      if (open[open.length - 1] !== dialog.current) return;
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
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className={`modal ${size ?? (wide ? "wide" : "")}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          {dismissible && (
            <button
              className="icon-button"
              aria-label="关闭对话框"
              onClick={onClose}
            >
              <X size={19} />
            </button>
          )}
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
  trigger,
  align = "end",
}: {
  children: ReactNode;
  label?: string;
  trigger?: ReactNode;
  align?: "start" | "end";
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
      className={`action-menu align-${align}`}
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          event.stopPropagation();
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        aria-label={label}
        title={trigger ? undefined : label}
        className={trigger ? "with-label" : undefined}
      >
        {trigger ?? <MoreHorizontal size={18} />}
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

// Transient confirmations. Errors that need a decision stay inline on the page.
interface Toast {
  id: number;
  message: string;
  tone: "success" | "error";
  action?: { label: string; run: () => void };
}
type Notify = (
  message: string,
  options?: { tone?: Toast["tone"]; action?: Toast["action"] },
) => void;
const ToastContext = createContext<Notify>(() => {});
export const useNotify = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((t) => t.id !== id)),
    [],
  );
  const notify = useCallback<Notify>(
    (message, options) => {
      const id = next.current++;
      setToasts((list) => [
        ...list.slice(-2),
        {
          id,
          message,
          tone: options?.tone ?? "success",
          action: options?.action,
        },
      ]);
      setTimeout(() => dismiss(id), options?.action ? 9000 : 5000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.tone}`}
            role="status"
          >
            {toast.tone === "success" ? (
              <CheckCircle2 size={17} />
            ) : (
              <AlertCircle size={17} />
            )}
            <span>{toast.message}</span>
            {toast.action && (
              <button
                className="text-button"
                onClick={() => {
                  toast.action!.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              className="icon-button"
              aria-label="关闭提示"
              onClick={() => dismiss(toast.id)}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
