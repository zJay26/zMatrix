import { useEffect, useState } from "react";
import { Send, FileCheck2, LoaderCircle } from "lucide-react";
import { channels } from "../platforms/catalog";
import { db } from "../core/db";
import { freezeSnapshot, newVariant } from "../core/variants";
import { prepareContent, preflight } from "../core/render";
import { enqueue } from "../core/tasks";
import type {
  Article,
  ChannelId,
  Mode,
  PreparedContent,
  Snapshot,
} from "../core/model";
import { messageOf } from "../core/model";
import { Modal, Alert, command } from "./shared";
import { MarkdownPreview } from "./Markdown";
export function PublishDialog({
  article,
  onClose,
  onCreated,
}: {
  article: Article;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [selected, setSelected] = useState<ChannelId[]>([]);
  const [mode, setMode] = useState<Mode>("draft");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<
    { snapshot: Snapshot; prepared: PreparedContent }[]
  >([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    setPrepared([]);
  }, [selected, mode]);
  const preview = async () => {
    setBusy(true);
    setError("");
    try {
      const result = [];
      for (const channel of selected) {
        const variant =
          (await db.variants.get(`${article.id}/${channel}`)) ??
          newVariant(article, channel);
        const snapshot = await freezeSnapshot(article, variant);
        const errors = preflight(snapshot, mode);
        if (errors.length)
          throw new Error(
            `${channels.find((c) => c.id === channel)?.short}：${errors.join("；")}。请回到对应平台版本填写。`,
          );
        result.push({ snapshot, prepared: await prepareContent(snapshot) });
      }
      setPrepared(result);
      setActive(0);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const create = async (start: boolean) => {
    setBusy(true);
    try {
      const tasks = await enqueue(prepared, mode);
      if (start) await command({ type: "run", ids: tasks.map((t) => t.id) });
      onCreated();
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="发布预览" onClose={onClose} wide>
      <div className="publish-options">
        <div className="mode-switch">
          <button
            className={mode === "draft" ? "selected" : ""}
            onClick={() => setMode("draft")}
          >
            <FileCheck2 size={17} />
            保存草稿
          </button>
          <button
            className={mode === "publish" ? "selected" : ""}
            onClick={() => setMode("publish")}
          >
            <Send size={17} />
            准备发布，手动确认
          </button>
        </div>
        <div className="target-grid">
          {channels
            .filter((c) => !c.manual)
            .map((c) => (
              <label
                className={`target ${selected.includes(c.id) ? "checked" : ""}`}
                key={c.id}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, c.id]
                        : selected.filter((id) => id !== c.id),
                    )
                  }
                />
                <i style={{ background: c.color }} />
                {c.name}
              </label>
            ))}
        </div>
        <p className="muted">
          使用 Edge
          中当前登录账号。准备发布会停在最终提交前，由你在原站手动发布。未核对齐全的设置会单独提示。
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {!!prepared.length && (
        <div className="publish-preview">
          <div className="tabs">
            {prepared.map((p, i) => (
              <button
                key={p.snapshot.channel}
                className={active === i ? "active" : ""}
                onClick={() => setActive(i)}
              >
                {channels.find((c) => c.id === p.snapshot.channel)?.short}
              </button>
            ))}
          </div>
          <h2>{prepared[active]!.snapshot.title}</h2>
          <div className="preview-gallery">
            {prepared[active]!.snapshot.imageIds.map((id, index) => {
              const asset = prepared[active]!.prepared.assets.find(
                (a) => a.id === id,
              );
              return asset ? (
                <figure key={id}>
                  <img src={asset.dataUrl} alt={`配图 ${index + 1}`} />
                  <figcaption>
                    {index + 1}
                    {prepared[active]!.snapshot.metadata.coverId === id
                      ? " · 封面"
                      : ""}
                  </figcaption>
                </figure>
              ) : null;
            })}
          </div>
          <p className="muted">
            分类：{prepared[active]!.snapshot.metadata.category || "未指定"} ·
            标签：
            {prepared[active]!.snapshot.metadata.tags.join("、") || "未指定"}
          </p>
          {prepared[active]!.prepared.warnings.map((w) => (
            <Alert key={w}>{w}</Alert>
          ))}
          <MarkdownPreview value={prepared[active]!.prepared.markdown} />
        </div>
      )}
      <footer className="modal-actions">
        <span className="muted">已选 {selected.length} 个发布路径</span>
        {!prepared.length ? (
          <button
            className="primary"
            disabled={!selected.length || busy}
            onClick={() => void preview()}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : null}
            生成各平台预览
          </button>
        ) : (
          <>
            <button disabled={busy} onClick={() => void create(false)}>
              加入待执行队列
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void create(true)}
            >
              {mode === "publish"
                ? `准备 ${selected.length} 个平台，停在发布前`
                : `保存 ${selected.length} 份平台草稿`}
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}
