import { useEffect, useRef, useState } from "react";
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
  Variant,
} from "../core/model";
import { messageOf } from "../core/model";
import { Modal, Alert, command } from "./shared";
import { MarkdownPreview } from "./Markdown";
import { MetadataFields, type MetadataHandle } from "./MetadataFields";
import {
  getPublishSelection,
  savePublishSelection,
} from "../core/publish-preferences";
import { resolveContent } from "../core/variants";
export function PublishDialog({
  article,
  variants,
  onVariantChange,
  onFlush,
  onEditPlatform,
  onClose,
  onCreated,
}: {
  article: Article;
  variants: Record<string, Variant>;
  onVariantChange: (
    channel: ChannelId,
    update: (variant: Variant) => Variant,
  ) => void;
  onFlush: () => Promise<boolean>;
  onEditPlatform: (channel: ChannelId) => void;
  onClose: () => void;
  onCreated: () => void;
}) {
  const available = channels.filter((channel) => !channel.manual);
  const [selected, setSelected] = useState<ChannelId[]>([]);
  const [mode, setMode] = useState<Mode>("draft");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<
    { snapshot: Snapshot; prepared: PreparedContent }[]
  >([]);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const [settingsChannel, setSettingsChannel] = useState<ChannelId | null>(
    null,
  );
  const metadataEditor = useRef<MetadataHandle>(null);
  const changeSelection = (next: ChannelId[], nextMode = mode) => {
    metadataEditor.current?.flush();
    setError("");
    for (const id of next) if (!variants[id]) onVariantChange(id, (v) => v);
    setSelected(next);
    setMode(nextMode);
    void savePublishSelection(next, nextMode).catch((e) =>
      setError(messageOf(e)),
    );
  };
  useEffect(() => {
    let mounted = true;
    void getPublishSelection()
      .then((value) => {
        if (mounted) {
          setSelected(value.selected);
          setMode(value.mode);
          setReady(true);
        }
      })
      .catch((e) => {
        if (mounted) {
          setError(messageOf(e));
          setReady(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);
  const sourceVersion = JSON.stringify(variants);
  useEffect(() => {
    setPrepared([]);
  }, [selected, mode, sourceVersion]);
  const close = async () => {
    if (busy) return;
    metadataEditor.current?.flush();
    if (await onFlush()) onClose();
    else setError("平台设置尚未保存，请先处理保存错误。");
  };
  const preview = async () => {
    setBusy(true);
    setError("");
    try {
      metadataEditor.current?.flush();
      if (!(await onFlush()))
        throw new Error("平台设置尚未保存，请先处理保存错误。");
      const result = [];
      const snapshots: Snapshot[] = [];
      const issues: { channel: ChannelId; text: string }[] = [];
      for (const channel of selected) {
        const variant =
          (await db.variants.get(`${article.id}/${channel}`)) ??
          newVariant(article, channel);
        const snapshot = await freezeSnapshot(article, variant);
        const errors = preflight(snapshot, mode);
        if (errors.length)
          issues.push({
            channel,
            text: `${channels.find((c) => c.id === channel)?.short}：${errors.join("；")}`,
          });
        snapshots.push(snapshot);
      }
      if (issues.length) {
        setSettingsChannel(issues[0]!.channel);
        throw new Error(issues.map((i) => i.text).join("。"));
      }
      for (const snapshot of snapshots)
        result.push({ snapshot, prepared: await prepareContent(snapshot) });
      setSettingsChannel(null);
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
      // Remember platforms used through restored defaults, even when no field was edited.
      for (const id of selected)
        if (!variants[id]) onVariantChange(id, (v) => v);
      if (!(await onFlush()))
        throw new Error("平台版本尚未保存，请先处理保存错误。");
      const tasks = await enqueue(prepared, mode);
      if (start) {
        try {
          await command({ type: "run", ids: tasks.map((t) => t.id) });
        } catch (e) {
          await db.meta.put({ key: "queueError", value: messageOf(e) });
        }
      }
      onCreated();
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="发布准备" onClose={() => void close()} wide>
      <div className="publish-options">
        <div className="mode-switch">
          <button
            disabled={busy || !ready}
            className={mode === "draft" ? "selected" : ""}
            onClick={() => changeSelection(selected, "draft")}
          >
            <FileCheck2 size={17} />
            保存草稿
          </button>
          <button
            disabled={busy || !ready}
            className={mode === "publish" ? "selected" : ""}
            onClick={() => changeSelection(selected, "publish")}
          >
            <Send size={17} />
            准备发布，手动确认
          </button>
        </div>
        <div className="publish-selection-bar">
          <span>
            发布平台{" "}
            <span className="muted">
              已选 {selected.length} / {available.length}
            </span>
          </span>
          <button
            type="button"
            className="text-button"
            disabled={busy || !ready}
            onClick={() =>
              changeSelection(
                selected.length === available.length
                  ? []
                  : available.map((channel) => channel.id),
              )
            }
          >
            {selected.length === available.length ? "取消全选" : "全选"}
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
                  disabled={busy || !ready}
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    changeSelection(
                      e.target.checked
                        ? [...selected, c.id]
                        : selected.filter((id) => id !== c.id),
                    )
                  }
                />
                <i style={{ background: c.color }} />
                <span>{c.name}</span>
              </label>
            ))}
        </div>
      </div>
      {selected.includes("cnblogs:article") && (
        <p className="muted">
          博客园会自动填入内容；发布和保存草稿都需你在原站亲自点击。
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      {!!selected.length && !prepared.length && (
        <fieldset className="publish-fields" disabled={busy}>
          <legend>平台设置</legend>
          <div className="tabs">
            {selected.map((id) => (
              <button
                key={id}
                className={settingsChannel === id ? "active" : ""}
                onClick={() => {
                  metadataEditor.current?.flush();
                  setSettingsChannel(settingsChannel === id ? null : id);
                }}
              >
                {channels.find((c) => c.id === id)?.short}
              </button>
            ))}
          </div>
          {settingsChannel &&
            selected.includes(settingsChannel) &&
            (() => {
              const id = settingsChannel;
              const variant = variants[id] ?? newVariant(article, id);
              const content = resolveContent(article, variant);
              return (
                <div className="publish-field-editor">
                  <label className="form-stack">
                    平台标题
                    <input
                      aria-label="发布平台标题"
                      value={content.title}
                      onChange={(e) => {
                        const title = e.target.value;
                        onVariantChange(id, (v) => ({
                          ...v,
                          overrides: { ...v.overrides, title },
                        }));
                      }}
                    />
                  </label>
                  <MetadataFields
                    key={id}
                    ref={metadataEditor}
                    channel={id}
                    metadata={variant.metadata}
                    markdown={content.markdown}
                    onChange={(update) =>
                      onVariantChange(id, (v) => ({
                        ...v,
                        metadata: update(v.metadata),
                      }))
                    }
                  />
                  <div className="button-row">
                    {!!content.imageIds.length && (
                      <label>
                        封面{" "}
                        <select
                          aria-label="发布封面"
                          value={variant.metadata.coverId ?? ""}
                          onChange={(e) => {
                            const coverId = e.target.value || undefined;
                            onVariantChange(id, (v) => ({
                              ...v,
                              metadata: { ...v.metadata, coverId },
                            }));
                          }}
                        >
                          <option value="">未指定</option>
                          {content.imageIds.map((assetId, i) => (
                            <option key={assetId} value={assetId}>
                              配图 {i + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      onClick={() => {
                        metadataEditor.current?.flush();
                        void onFlush().then((saved) => {
                          if (saved) onEditPlatform(id);
                          else setError("请先处理未保存的编辑。");
                        });
                      }}
                    >
                      编辑正文与配图
                    </button>
                  </div>
                </div>
              );
            })()}
        </fieldset>
      )}
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
            disabled={!selected.length || busy || !ready}
            onClick={() => void preview()}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : null}
            检查并预览
          </button>
        ) : (
          <>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void create(false)}
            >
              加入队列，稍后执行
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
