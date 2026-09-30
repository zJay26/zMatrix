import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  Send,
  Images,
  ImagePlus,
  Undo2,
  ExternalLink,
  Copy,
  GitCompareArrows,
  Download,
  Save,
} from "lucide-react";
import { diffLines } from "diff";
import { db, changed, saveArticle, saveVariant } from "../core/db";
import { SaveQueue } from "../core/autosave";
import { copyDraft } from "../core/library";
import { channels } from "../platforms/catalog";
import {
  clearOverride,
  freezeSnapshot,
  isVariantBehind,
  newVariant,
  resolveContent,
  setOverride,
  snapshotDiffers,
} from "../core/variants";
import { addAsset, downloadBlob } from "../core/assets";
import type {
  Article,
  Asset,
  ChannelId,
  Content,
  Variant,
} from "../core/model";
import { messageOf } from "../core/model";
import { MarkdownEditor, MarkdownPreview } from "./Markdown";
import { Modal, Alert, PlatformPill, useBlobUrl } from "./shared";
import { CardStudio } from "./CardStudio";
import { PublishDialog } from "./PublishDialog";
import { MetadataFields, type MetadataHandle } from "./MetadataFields";

function AssetThumbnail({
  asset,
  onInsert,
  onRemove,
  cover,
  onCover,
}: {
  asset: Asset;
  onInsert: () => void;
  onRemove: () => void;
  cover: boolean;
  onCover: () => void;
}) {
  const url = useBlobUrl(asset.blob);
  return (
    <div className="asset-tile">
      <img src={url || undefined} alt={asset.name} />
      <span title={asset.name}>{asset.name}</span>
      <div>
        <button onClick={onInsert}>插入</button>
        <button className={cover ? "selected" : ""} onClick={onCover}>
          {cover ? "封面" : "设封面"}
        </button>
        <button aria-label={`移除配图 ${asset.name}`} onClick={onRemove}>
          ×
        </button>
      </div>
    </div>
  );
}
export function EditorPage({
  initial,
  onBack,
  onQueue,
  onFlushReady,
  onOpenCopy,
  defaultViewMode = "split",
}: {
  initial: Article;
  onBack: () => void;
  onQueue: () => void;
  onFlushReady: (flush: () => Promise<boolean>) => void;
  onOpenCopy: (article: Article) => void;
  defaultViewMode?: "split" | "source" | "preview";
}) {
  const [article, setArticle] = useState(initial);
  const articleRef = useRef(article);
  const [selected, setSelected] = useState<ChannelId | "master">("master");
  const storedQuery = useLiveQuery(
    () => db.variants.where("articleId").equals(initial.id).toArray(),
    [initial.id],
  );
  const stored = storedQuery ?? [];
  const [localVariants, setLocalVariants] = useState<Record<string, Variant>>(
    {},
  );
  const localRef = useRef(localVariants);
  const [saveStatus, setSaveStatus] = useState({ pending: false, error: "" });
  const [saveQueue] = useState(() => new SaveQueue(setSaveStatus));
  const committedArticle = useRef(initial);
  const committedVariants = useRef(new Map<string, Variant | undefined>());
  const uploads = useRef(new Set<Promise<void>>());
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<"split" | "source" | "preview">(
    defaultViewMode,
  );
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selection, setSelection] = useState("");
  const [studio, setStudio] = useState(false);
  const [publish, setPublish] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const metadataEditor = useRef<MetadataHandle>(null);
  const variants = {
    ...Object.fromEntries(stored.map((v) => [v.channel, v])),
    ...localVariants,
  };
  const variant =
    selected === "master"
      ? undefined
      : (variants[selected] ?? newVariant(article, selected));
  const content = resolveContent(article, variant);
  const assets = useLiveQuery(
    () => db.assets.bulkGet(content.imageIds),
    [content.imageIds.join(",")],
    [],
  );
  const posts = useLiveQuery(
    () => db.posts.where("articleId").equals(initial.id).toArray(),
    [initial.id],
    [],
  );
  const putVariant = (next: Variant) => {
    if (!committedVariants.current.has(next.channel))
      committedVariants.current.set(
        next.channel,
        stored.find((v) => v.channel === next.channel),
      );
    next = { ...next, updatedAt: Date.now() };
    localRef.current = { ...localRef.current, [next.channel]: next };
    setLocalVariants(localRef.current);
    saveQueue.enqueue(next.id, async () => {
      await saveVariant(next, db, {
        expected: committedVariants.current.get(next.channel),
      });
      committedVariants.current.set(next.channel, next);
    });
  };
  const currentVariant = (id: ChannelId) =>
    localRef.current[id] ??
    stored.find((v) => v.channel === id) ??
    newVariant(articleRef.current, id);
  const change = <K extends keyof Content>(key: K, value: Content[K]) => {
    const current = resolveContent(
      articleRef.current,
      selected === "master" ? undefined : currentVariant(selected),
    );
    if (JSON.stringify(current[key]) === JSON.stringify(value)) return;
    if (selected === "master") {
      const next = {
        ...articleRef.current,
        [key]: value,
        revision: articleRef.current.revision + 1,
        updatedAt: Date.now(),
      };
      articleRef.current = next;
      setArticle(next);
      saveQueue.enqueue("master", async () => {
        await saveArticle(next, db, { expected: committedArticle.current });
        committedArticle.current = next;
      });
    } else putVariant(setOverride(currentVariant(selected), key, value));
  };
  const reset = (key: keyof Content) => {
    if (selected !== "master")
      putVariant(
        clearOverride(currentVariant(selected), key, article.revision),
      );
  };
  const doImportImages = async (files: File[]) => {
    try {
      const imported = [];
      for (const file of files) imported.push(await addAsset(file));
      const current = resolveContent(
        articleRef.current,
        selected === "master" ? undefined : currentVariant(selected),
      );
      change("imageIds", [
        ...new Set([...current.imageIds, ...imported.map((a) => a.id)]),
      ]);
      change(
        "markdown",
        current.markdown +
          "\n\n" +
          imported
            .map((a) => `![${a.name.replaceAll("]", "")}](asset://${a.id})`)
            .join("\n\n"),
      );
    } catch (error) {
      setError(messageOf(error));
    }
  };
  const importImages = (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    const job = doImportImages(files).finally(() => {
      uploads.current.delete(job);
      setUploading(uploads.current.size > 0);
    });
    uploads.current.add(job);
  };
  const flush = async () => {
    metadataEditor.current?.flush();
    while (uploads.current.size) await Promise.all([...uploads.current]);
    return saveQueue.flush();
  };
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (
        saveQueue.status.pending ||
        saveQueue.status.error ||
        metadataEditor.current?.hasPending() ||
        uploads.current.size
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveQueue]);
  useEffect(() => {
    onFlushReady(flush);
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      onFlushReady(async () => true);
      window.removeEventListener("keydown", keydown);
    };
  }, [onFlushReady, saveQueue]);
  const switchPage = async (action: () => void) => {
    if (await flush()) action();
  };
  const exportContent = async () => {
    setExporting(true);
    setError("");
    try {
      const { exportCurrentContent, safeFilename } =
        await import("../core/export");
      downloadBlob(
        await exportCurrentContent(content, variant?.metadata),
        `${safeFilename(content.title)}.zip`,
      );
      setNotice("当前版本已导出，包含 Markdown、稿件信息和配套图片。");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="editor-page">
      <div className="editor-top">
        <button className="ghost" onClick={() => void switchPage(onBack)}>
          <ArrowLeft size={18} />
          内容库
        </button>
        <span className="save-state" role="status">
          <i
            className={saveStatus.pending || saveStatus.error ? "pending" : ""}
          />
          {saveStatus.error
            ? "尚有未保存的编辑"
            : saveStatus.pending || uploading
              ? "正在保存…"
              : "本地已保存"}
        </span>
        <button
          disabled={exporting || uploading}
          onClick={() => void exportContent()}
        >
          <Download size={16} />
          导出当前版本
        </button>
        <button onClick={() => setStudio(true)}>
          <Images size={17} />
          制作图文
        </button>
        <button
          className="primary"
          onClick={() => void switchPage(() => setPublish(true))}
        >
          <Send size={16} />
          发布预览
        </button>
      </div>
      <div className="version-strip" aria-label="稿件版本">
        <button
          className={selected === "master" ? "active master-tab" : "master-tab"}
          onClick={() => {
            setSelection("");
            setSelected("master");
          }}
          disabled={uploading}
        >
          母稿
        </button>
        {channels.map((c) => (
          <button
            key={c.id}
            className={selected === c.id ? "active" : ""}
            onClick={() => {
              setSelection("");
              setSelected(c.id);
            }}
            disabled={!storedQuery || uploading}
          >
            <i style={{ background: c.color }} />
            {c.short}
            <small>
              {Object.keys(variants[c.id]?.overrides ?? {}).length
                ? "独立编辑"
                : "跟随母稿"}
            </small>
          </button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && (
        <div className="success-notice editor-notice" role="status">
          {notice}
          <button className="text-button" onClick={() => setNotice("")}>
            关闭
          </button>
        </div>
      )}
      {saveStatus.error && (
        <Alert>
          <p>{saveStatus.error}</p>
          <div className="button-row">
            <button onClick={() => void saveQueue.retry()}>重试保存</button>
            <button
              disabled={exporting || uploading}
              onClick={() => {
                setExporting(true);
                const articleAtStart = articleRef.current;
                const variantsAtStart = localRef.current;
                void copyDraft(articleAtStart, Object.values(variants))
                  .then((copy) => {
                    if (
                      articleRef.current !== articleAtStart ||
                      localRef.current !== variantsAtStart
                    ) {
                      setNotice(
                        "副本已保存到内容库。另存期间又有新的编辑，请再次另存以保留最新内容。",
                      );
                      return;
                    }
                    saveQueue.discard();
                    onOpenCopy(copy);
                  })
                  .catch((e) => setError(messageOf(e)))
                  .finally(() => setExporting(false));
              }}
            >
              <Save size={15} />
              另存为新稿
            </button>
          </div>
          <p>
            当前编辑仍保留在此页面。另存会复制母稿和平台版本，原稿保持原样。
          </p>
        </Alert>
      )}
      {isVariantBehind(article, variant) && (
        <div className="version-notice">
          母稿已更新，此平台的独立内容保持原样。
          <button onClick={() => setShowDiff(true)}>
            <GitCompareArrows size={15} />
            查看差异
          </button>
          <button
            onClick={() =>
              putVariant({
                ...variant!,
                baseRevision: article.revision,
                updatedAt: Date.now(),
              })
            }
          >
            已核对，保留此版本
          </button>
        </div>
      )}
      <div className="title-row">
        <input
          className="article-title"
          aria-label="文章标题"
          placeholder="给这篇稿件起个标题"
          value={content.title}
          onChange={(e) => change("title", e.target.value)}
        />
        {variant?.overrides.title !== undefined && (
          <button title="标题重新跟随母稿" onClick={() => reset("title")}>
            <Undo2 size={16} />
          </button>
        )}
      </div>
      {variant && (
        <MetadataFields
          key={variant.channel}
          ref={metadataEditor}
          channel={variant.channel}
          metadata={variant.metadata}
          markdown={content.markdown}
          onChange={(update) => {
            const current = currentVariant(variant.channel);
            putVariant({ ...current, metadata: update(current.metadata) });
          }}
        />
      )}
      {selected === "linuxdo:topic" && (
        <div className="manual-tools">
          <span>LINUX DO 人工发布辅助</span>
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(content.markdown)
                .catch((e) => setError(messageOf(e)));
            }}
          >
            <Copy size={15} />
            复制 Markdown
          </button>
          <a href="https://linux.do/" target="_blank" rel="noreferrer">
            打开原站
            <ExternalLink size={14} />
          </a>
        </div>
      )}
      <div className="writing-toolbar">
        <div className="view-switch" aria-label="编辑视图">
          {(
            [
              ["source", "专注写作"],
              ["split", "双栏对照"],
              ["preview", "阅读预览"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={viewMode === id}
              className={viewMode === id ? "selected" : ""}
              onClick={() => setViewMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted">
          {content.markdown.length.toLocaleString()} 字符 · 约{" "}
          {Math.max(
            1,
            Math.ceil(content.markdown.replace(/\s/g, "").length / 500),
          )}{" "}
          分钟阅读
        </span>
      </div>
      <div className={`writing-grid writing-${viewMode}`}>
        <section className="source-pane" hidden={viewMode === "preview"}>
          <header>
            <span>Markdown 源码</span>
            <div>
              <button
                className="text-button"
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus size={15} />
                插入图片
              </button>
              {variant?.overrides.markdown !== undefined && (
                <button
                  className="text-button"
                  onClick={() => reset("markdown")}
                >
                  <Undo2 size={15} />
                  正文跟随母稿
                </button>
              )}
            </div>
          </header>
          <MarkdownEditor
            key={selected}
            value={content.markdown}
            onChange={(v) => change("markdown", v)}
            onSelect={setSelection}
            onPasteImage={(files) => void importImages(files)}
          />
        </section>
        <section className="preview-pane" hidden={viewMode === "source"}>
          <header>
            <span>内容预览</span>
            <span>{content.markdown.length.toLocaleString()} 字符</span>
          </header>
          {viewMode !== "source" && (
            <MarkdownPreview value={content.markdown} />
          )}
        </section>
      </div>
      <input
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        ref={fileInput}
        onChange={(e) => {
          void importImages(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <section className="attachments">
        <header>
          <h3>
            配图 <span>{content.imageIds.length}</span>
          </h3>
          {variant?.overrides.imageIds !== undefined && (
            <button className="text-button" onClick={() => reset("imageIds")}>
              配图跟随母稿
            </button>
          )}
        </header>
        <div className="asset-grid">
          {assets
            .flatMap((a) => (a ? [a] : []))
            .map((a) => (
              <AssetThumbnail
                key={a.id}
                asset={a}
                cover={variant?.metadata.coverId === a.id}
                onCover={() => {
                  if (variant)
                    putVariant({
                      ...variant,
                      metadata: { ...variant.metadata, coverId: a.id },
                    });
                  else setError("请切换到具体平台版本后选择封面。");
                }}
                onInsert={() =>
                  change(
                    "markdown",
                    content.markdown +
                      `\n\n![${a.name.replaceAll("]", "")}](asset://${a.id})`,
                  )
                }
                onRemove={() =>
                  change(
                    "imageIds",
                    content.imageIds.filter((id) => id !== a.id),
                  )
                }
              />
            ))}
          <button
            className="add-asset"
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={23} />
            添加图片
          </button>
        </div>
      </section>
      {!!posts.length && (
        <section className="publication-list">
          <h3>发布记录与版本</h3>
          {posts.map((post) => {
            const current = variants[post.channel];
            const behind =
              post.snapshot && snapshotDiffers(post.snapshot, article, current);
            return (
              <div className="publication-row" key={post.id}>
                <PlatformPill id={post.channel} />
                <span>{post.title}</span>
                <span className={behind ? "warning-text" : "muted"}>
                  {behind
                    ? "当前稿件有更新"
                    : post.snapshot
                      ? "与登记版本一致"
                      : "尚无版本快照"}
                </span>
                <a href={post.url} target="_blank" rel="noreferrer">
                  查看原文
                  <ExternalLink size={14} />
                </a>
                {behind && (
                  <button
                    onClick={() =>
                      void (async () => {
                        try {
                          const snapshot = await freezeSnapshot(
                            article,
                            current ?? newVariant(article, post.channel),
                          );
                          await db.posts.update(post.id, {
                            snapshot,
                            updatedAt: Date.now(),
                          });
                          await changed();
                        } catch (e) {
                          setError(messageOf(e));
                        }
                      })()
                    }
                  >
                    已在原站更新，登记当前版本
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}
      {studio && (
        <CardStudio
          title={content.title}
          markdown={selection || content.markdown}
          onClose={() => setStudio(false)}
          onUse={async (blobs) => {
            const ids = [];
            for (const [i, blob] of blobs.entries()) {
              ids.push(
                (
                  await addAsset(
                    Object.assign(blob, { name: `图文-${i + 1}.png` }),
                  )
                ).id,
              );
            }
            const next = setOverride(
              currentVariant("xiaohongshu:note"),
              "imageIds",
              ids,
            );
            putVariant(next);
            if (!(await saveQueue.flush()))
              throw new Error(
                "图文已加入当前编辑，但尚未保存成功。请处理保存提示。",
              );
            setSelected("xiaohongshu:note");
          }}
        />
      )}
      {publish && (
        <PublishDialog
          article={article}
          onClose={() => setPublish(false)}
          onCreated={onQueue}
        />
      )}
      {showDiff && variant && (
        <Modal
          title="母稿与平台版本差异"
          onClose={() => setShowDiff(false)}
          wide
        >
          <div className="form-stack">
            <h3>标题</h3>
            <p>母稿：{article.title || "未填写"}</p>
            <p>平台版本：{content.title || "未填写"}</p>
            <details>
              <summary>
                配图对比（母稿 {article.imageIds.length} 张 · 平台{" "}
                {content.imageIds.length} 张）
              </summary>
              <h4>母稿配图</h4>
              <MarkdownPreview
                value={article.imageIds
                  .map((id) => `![母稿配图](asset://${id})`)
                  .join("\n\n")}
              />
              <h4>平台配图</h4>
              <MarkdownPreview
                value={content.imageIds
                  .map((id) => `![平台配图](asset://${id})`)
                  .join("\n\n")}
              />
            </details>
            <h3>正文</h3>
          </div>
          <div className="diff-body">
            {diffLines(article.markdown, content.markdown).map((part, i) => (
              <pre
                key={i}
                className={
                  part.added ? "diff-added" : part.removed ? "diff-removed" : ""
                }
              >
                {part.value}
              </pre>
            ))}
          </div>
          <footer className="modal-actions">
            <span className="muted">绿色为平台版本内容，红色为母稿内容。</span>
            <button onClick={() => setShowDiff(false)}>保留编辑，返回</button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
