import { useState } from "react";
import { Trash2, Search } from "lucide-react";
import { cleanUnusedAssets, inspectUnusedAssets } from "../core/cleanup";
import { messageOf } from "../core/model";
import { Alert, ConfirmDialog } from "./shared";

const sizeLabel = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function CleanupSettings() {
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof inspectUnusedAssets>
  > | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <div className="cleanup-settings">
      <h2>清理未使用素材</h2>
      <p className="muted">
        仅清理已无引用的图片。回收站、正文、封面和发布记录中的图片会保留；最近
        24 小时导入或重新使用的图片暂不清理。
      </p>
      <div className="button-row">
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            setNotice("");
            void inspectUnusedAssets()
              .then(setResult)
              .catch((e) => setError(messageOf(e)))
              .finally(() => setBusy(false));
          }}
        >
          <Search size={16} />
          {busy ? "正在检查…" : "检查可清理素材"}
        </button>
        {result && (
          <span role="status">
            {result.count} 张 · {sizeLabel(result.bytes)}
          </span>
        )}
        {!!result?.count && (
          <button
            className="danger-text"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={16} />
            清理素材
          </button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <p role="status">{notice}</p>}
      {confirm && result && (
        <ConfirmDialog
          title="清理未使用的图片？"
          confirmLabel="确认清理"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const cleaned = await cleanUnusedAssets(result.ids);
            setResult(null);
            setNotice(
              `已清理 ${cleaned.count} 张图片，释放 ${sizeLabel(cleaned.bytes)}。`,
            );
          }}
        >
          <p>
            预计清理 {result.count} 张图片，释放 {sizeLabel(result.bytes)}
            。操作无法撤销，清理前会再次检查引用，保留刚被使用的图片。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
